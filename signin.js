function $(sel, el) {
  return (el || document).querySelector(sel);
}

function $$(sel, el) {
  return (el || document).querySelectorAll(sel);
}

(async function () {
  "use strict";

  // from env.js
  let ENV = window.ENV;

  // scheme => 'https:'
  // host => 'localhost:3000'
  // pathname => '/api/authn/session/oidc/google.com'
  //let baseUrl = document.location.protocol + "//" + document.location.host;
  let baseUrl = ENV.BASE_API_URL;

  function noop() {}

  function die(err) {
    console.error(err);
    window.alert(
      "Oops! There was an unexpected error on the server.\nIt's not your fault.\n\n" +
        "Technical Details for Tech Support: \n" +
        err.message
    );
    throw err;
  }

  async function attemptRefresh() {
    let resp = await window
      .fetch(baseUrl + "/api/authn/refresh", { method: "POST" })
      .catch(noop);
    if (!resp) {
      return;
    }
    return await resp.json().catch(die);
  }

  async function importKey(key64) {
    let crypto = window.crypto;
    let usages = ["encrypt", "decrypt"];
    let extractable = false;
    let rawKey = base64ToBuffer(key64);

    return await crypto.subtle.importKey(
      "raw",
      rawKey,
      { name: "AES-CBC" },
      extractable,
      usages
    );
  }

  function base64ToBuffer(base64) {
    function binaryStringToBuffer(binstr) {
      var buf;

      if ("undefined" !== typeof Uint8Array) {
        buf = new Uint8Array(binstr.length);
      } else {
        buf = [];
      }

      Array.prototype.forEach.call(binstr, function (ch, i) {
        buf[i] = ch.charCodeAt(0);
      });

      return buf;
    }
    var binstr = atob(base64);
    var buf = binaryStringToBuffer(binstr);
    return buf;
  }

  function bufferToBase64(arr) {
    function bufferToBinaryString(buf) {
      var binstr = Array.prototype.map
        .call(buf, function (ch) {
          return String.fromCharCode(ch);
        })
        .join("");

      return binstr;
    }
    var binstr = bufferToBinaryString(arr);
    return btoa(binstr);
  }

  async function encryptObj(obj, key) {
    var crypto = window.crypto;
    var ivLen = 16; // the IV is always 16 bytes
    console.log(key);

    function joinIvAndData(iv, data) {
      var buf = new Uint8Array(iv.length + data.length);
      Array.prototype.forEach.call(iv, function (byte, i) {
        buf[i] = byte;
      });
      Array.prototype.forEach.call(data, function (byte, i) {
        buf[ivLen + i] = byte;
      });
      return buf;
    }

    async function _encrypt(data, key) {
      // a public value that should be generated for changes each time
      var initializationVector = new Uint8Array(ivLen);

      crypto.getRandomValues(initializationVector);

      return await crypto.subtle
        .encrypt({ name: "AES-CBC", iv: initializationVector }, key, data)
        .then(function (encrypted) {
          var ciphered = joinIvAndData(
            initializationVector,
            new Uint8Array(encrypted)
          );

          var base64 = bufferToBase64(ciphered);
          /*
            .replace(/\-/g, "+")
            .replace(/_/g, "/");
          while (base64.length % 4) {
            base64 += "=";
          }
          */
          return base64;
        });
    }
    //return _encrypt(base64ToBuffer(b64), key);
    let u8 = new TextEncoder().encode(JSON.stringify(obj));
    return await _encrypt(u8, key);
  }

  async function decrypt64(b64, key) {
    var crypto = window.crypto;
    var ivLen = 16; // the IV is always 16 bytes

    function separateIvFromData(buf) {
      var iv = new Uint8Array(ivLen);
      var data = new Uint8Array(buf.length - ivLen);
      Array.prototype.forEach.call(buf, function (byte, i) {
        if (i < ivLen) {
          iv[i] = byte;
        } else {
          data[i - ivLen] = byte;
        }
      });
      return { iv: iv, data: data };
    }

    function _decrypt(buf, key) {
      var parts = separateIvFromData(buf);

      return crypto.subtle
        .decrypt({ name: "AES-CBC", iv: parts.iv }, key, parts.data)
        .then(function (decrypted) {
          var str = new TextDecoder().decode(new Uint8Array(decrypted));
          //var base64 = bufferToBase64(new Uint8Array(decrypted));
          /*
            .replace(/\-/g, "+")
            .replace(/_/g, "/");
          while (base64.length % 4) {
            base64 += "=";
          }
          */
          return JSON.parse(str);
        });
    }
    return _decrypt(base64ToBuffer(b64), key);
  }

  async function completeOauth2SignIn(baseUrl, query) {
    // nix token from browser history
    window.history.pushState(
      "",
      document.title,
      window.location.pathname + window.location.search
    );

    // Show the token for easy capture
    console.info("access_token", query.access_token);

    if ("github.com" === query.issuer) {
      // TODO this is moot. We could set the auth cookie at time of redirect
      // and include the real (our) id_token
      let resp = await window
        .fetch(baseUrl + "/api/authn/session/oauth2/github.com", {
          method: "POST",
          body: JSON.stringify({
            timezone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: window.navigator.language,
          }),
          headers: {
            Authorization: query.access_token,
            "Content-Type": "application/json",
          },
        })
        .catch(die);
      let result = await resp.json().catch(die);

      console.info("Our bespoken token(s):");
      console.info(result);

      await doStuffWithUser(result);
    }
    // TODO what if it's not github?
  }

  async function init() {
    $(".js-logout").hidden = true;
    $(".js-sign-in-github").hidden = true;

    var githubSignInUrl = Auth3000.generateOauth2Url(
      "https://github.com/login/oauth/authorize",
      ENV.GITHUB_CLIENT_ID,
      ENV.GITHUB_REDIRECT_URI,
      ["read:user", "user:email"]
    );
    $(".js-github-oauth2-url").href = githubSignInUrl;

    $(".js-logout").addEventListener("click", async function (ev) {
      ev.preventDefault();
      ev.stopPropagation();

      let resp = await window
        .fetch(baseUrl + "/api/authn/session", {
          method: "DELETE",
        })
        .catch(die);
      let result = await resp.json().catch(die);
      window.alert("Logged out!");
      init();
    });

    var querystring = document.location.hash.slice(1);
    var query = Auth3000.parseQuerystring(querystring);
    if (query.id_token) {
      completeOidcSignIn(query);
      return;
    }
    if (query.access_token && "bearer" === query.token_type) {
      completeOauth2SignIn(baseUrl, query);
      return;
    }

    let result = await attemptRefresh();
    console.info("Refresh Token: (may be empty)");
    console.info(result);

    if (result.id_token || result.access_token) {
      await doStuffWithUser(result);
      return;
    }

    $(".js-sign-in-github").hidden = false;
    //$(".js-social-login").hidden = false;
    return;
  }

  async function doStuffWithUser(result) {
    if (!result.id_token && !result.access_token) {
      window.alert("No token, something went wrong.");
      return;
    }
    $(".js-logout").hidden = false;

    let lastSync = new Date(
      parseInt(localStorage.getItem("bliss:last-sync"), 10) || 0
    );

    let resp = await window
      .fetch(baseUrl + "/api/dummy?since=" + lastSync.toISOString(), {
        method: "GET",
        headers: {
          Authorization: "Bearer " + (result.id_token || result.access_token),
        },
      })
      .catch(die);
    let items = await resp.json().catch(die);
    console.info("Items:");
    console.info(items);

    // Use MEGA-style https://site.com/invite#priv ?
    // hash(priv) => pub
    let key64 = localStorage.getItem("bliss:enc-key");
    let key = await importKey(key64).catch(showError);

    function showError(err) {
      console.error(err);
      window.alert("that's not a valid key");
    }
    if (!key) {
      if (!items.length) {
        let rawKeyBuf = crypto.getRandomValues(new Uint8Array(32));
        key64 = bufferToBase64(rawKeyBuf);
        localStorage.setItem("bliss:enc-key", key64);
      }
      while (items.length && !key64) {
        key64 = window.prompt("What's your encryption key?", "");
        key = await importKey(key64).catch(showError);
        // TODO try to decrypt
      }
    }

    let pushes = [];
    let receives = [];
    /*
    let remoteIds = PostModel.ids().reduce(function (map, id) {
      let post = PostModel.getOrCreate(id);
      map[post.sync_id] = true;
    }, {});
    */

    for (let item of items) {
      let data;
      try {
        // because this is double stringified (for now)
        data = JSON.parse(item.data);
      } catch (e) {
        console.warn("Could not parse:", err);
        console.warn(item.data);
      }

      // TODO decide which key to use (once we have shared projects)
      let post;
      try {
        post = await decrypt64(data.encrypted, key);
      } catch (e) {
        console.warn("Could not decrypt");
        console.warn(data);
        console.warn(e);
        continue;
      }
      if (post._type && "post" !== post._type) {
        console.warn("couldn't handle type", post._type);
        console.warn(post);
        continue;
      }

      console.log("[DEBUG]", lastSync, lastSync.valueOf());
      console.log(
        "[DEBUG]",
        item.updated_at,
        new Date(item.updated_at).valueOf()
      );
      if (lastSync.valueOf() < new Date(item.updated_at).valueOf()) {
        lastSync = new Date(item.updated_at);
      }

      post.sync_id = item.uuid;
      post.synced_at = item.updated_at;
      // TODO conflict resolution if this has been updated more recently
      console.log("decrypted", post.uuid);
      console.log(post);
      PostModel.save(post);
    }
    console.log("[DEBUG]", lastSync, lastSync.valueOf());
    localStorage.setItem("bliss:last-sync", lastSync.valueOf());

    // TODO handle offline case: if new things have not been synced, sync them

    Post._saveHook = async function (post) {
      if (post.sync_id) {
        console.warn("can't update items yet");
        return;
      }
      post._type = "post";

      let token = result.id_token || result.access_token;
      let resp = await window
        .fetch(baseUrl + "/api/dummy", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            data: JSON.stringify({ encrypted: await encryptObj(post, key) }),
          }),
        })
        .catch(die);
      post.sync_id = await resp.json().uuid;
      if (!result.id_token && !result.access_token) {
      }
    };

    await PostModel.ids().reduce(async function (p, id) {
      await p;
      let post = PostModel.getOrCreate(id);
      await Post._saveHook(post);
    }, Promise.resolve());
  }

  init().catch(function (err) {
    console.error(err);
    window.alert(`Fatal Error: ${err.message}`);
  });
})();
