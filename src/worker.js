/*
    https://github.com/hunshcn/gh-proxy
    https://www.bilibili.com/opus/924356874277486612
*/
const PREFIX = "/";
// 分支文件使用jsDelivr镜像的开关
const config = {
  jsdelivr: false,
};

const whiteList = []; // 白名单，路径里面有包含字符的才会通过，e.g. ['/username/']

/** @type {ResponseInit} */
const PREFLIGHT_INIT = {
  status: 204,
  headers: new Headers({
    "access-control-allow-origin": "*",
    "access-control-allow-methods":
      "GET,POST,PUT,PATCH,TRACE,DELETE,HEAD,OPTIONS",
    "access-control-max-age": "1728000",
  }),
};

const exp1 =
  /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:releases|archive)\/.*$/i;
const exp2 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:blob|raw)\/.*$/i;
const exp3 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/(?:info|git-).*$/i;
const exp4 =
  /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+?\/.+$/i;
const exp5 =
  /^(?:https?:\/\/)?gist\.(?:githubusercontent|github)\.com\/.+?\/.+?\/.+$/i;
const exp6 = /^(?:https?:\/\/)?github\.com\/.+?\/.+?\/tags.*$/i;

/**
 * @param {any} body
 * @param {number} status
 * @param {Object<string, string>} headers
 */
function makeRes(body, status = 200, headers = {}) {
  headers["access-control-allow-origin"] = "*";
  return new Response(body, { status, headers });
}

/**
 * @param {string} urlStr
 */
function newUrl(urlStr) {
  try {
    return new URL(urlStr);
  } catch (err) {
    return null;
  }
}

addEventListener("fetch", event => {
  const response = handleRequest(event.request).catch(err =>
    makeRes("cfworker error:\n" + err.stack, 502),
  );
  event.respondWith(response);
});

function checkUrl(u) {
  for (const i of [exp1, exp2, exp3, exp4, exp5, exp6]) {
    if (u.search(i) === 0) {
      return true;
    }
  }
  return false;
}

/**
 * @param {Request} request
 */
async function handleRequest(request) {
  const rawUrl = new URL(request.url);
  if (rawUrl.pathname === "/") {
    return new Response("Please enter the link after the /");
  }
  let urlSpedup =
    rawUrl.pathname.replace("/", "") + rawUrl.search + rawUrl.hash;

  // 处理GitHub加速
  if ([exp1, exp3, exp4, exp5, exp6].some(exp => urlSpedup.match(exp))) {
    return httpHandler(request, urlSpedup);
  } else if (urlSpedup.match(exp2)) {
    if (config.jsdelivr) {
      const newUrl = urlSpedup
        .replace("/blob/", "@")
        .replace(/^(?:https?:\/\/)?github\.com/, "https://cdn.jsdelivr.net/gh");
      return Response.redirect(newUrl, 302);
    } else {
      urlSpedup = urlSpedup.replace("/blob/", "/raw/");
      return httpHandler(request, urlSpedup);
    }
  } else if (urlSpedup.match(exp4)) {
    const newUrl = urlSpedup
      .replace(/(?<=com\/.+?\/.+?)\/(.+?\/)/, "@$1")
      .replace(
        /^(?:https?:\/\/)?raw\.(?:githubusercontent|github)\.com/,
        "https://cdn.jsdelivr.net/gh",
      );
    return Response.redirect(newUrl, 302);
  } else {
    // 一般加速
    const modifiedRequest = new Request(urlSpedup, {
      headers: request.headers,
      method: request.method,
      body: request.body,
      redirect: "follow",
    });
    const response = await fetch(modifiedRequest);
    const modifiedResponse = new Response(response.body, response);
    modifiedResponse.headers.set("Access-Control-Allow-Origin", "*");
    return modifiedResponse;
  }
}

/**
 * @param {Request} req
 * @param {string} pathname
 */
function httpHandler(req, pathname) {
  const reqHdrRaw = req.headers;

  // preflight
  if (
    req.method === "OPTIONS" &&
    reqHdrRaw.has("access-control-request-headers")
  ) {
    return new Response(null, PREFLIGHT_INIT);
  }

  const reqHdrNew = new Headers(reqHdrRaw);

  let urlStr = pathname;
  let flag = !whiteList.length;
  for (const i of whiteList) {
    if (urlStr.includes(i)) {
      flag = true;
      break;
    }
  }
  if (!flag) {
    return new Response("blocked", { status: 403 });
  }
  if (urlStr.startsWith("github")) {
    urlStr = "https://" + urlStr;
  }
  const urlObj = newUrl(urlStr);

  /** @type {RequestInit} */
  const reqInit = {
    method: req.method,
    headers: reqHdrNew,
    redirect: "manual",
    body: req.body,
  };
  return proxy(urlObj, reqInit);
}

/**
 *
 * @param {URL} urlObj
 * @param {RequestInit} reqInit
 */
async function proxy(urlObj, reqInit) {
  const res = await fetch(urlObj.href, reqInit);
  const resHdrOld = res.headers;
  const resHdrNew = new Headers(resHdrOld);

  const status = res.status;

  if (resHdrNew.has("location")) {
    const _location = resHdrNew.get("location");
    if (checkUrl(_location)) resHdrNew.set("location", PREFIX + _location);
    else {
      reqInit.redirect = "follow";
      return proxy(newUrl(_location), reqInit);
    }
  }
  resHdrNew.set("access-control-expose-headers", "*");
  resHdrNew.set("access-control-allow-origin", "*");

  resHdrNew.delete("content-security-policy");
  resHdrNew.delete("content-security-policy-report-only");
  resHdrNew.delete("clear-site-data");

  return new Response(res.body, {
    status,
    headers: resHdrNew,
  });
}
