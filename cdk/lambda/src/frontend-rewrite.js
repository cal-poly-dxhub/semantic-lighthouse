// archaic code for this function because its neccessary, idk why but it works lol
// middleman because of s3 and nextjs static site file descriptions (appends .html or index.html if not present)
function handler(event) {
  var request = event.request;
  var uri = request.uri;

  // return .js, .css, .png as is
  if (uri.match(/\.[a-zA-Z0-9]+$/)) {
    return request;
  }

  // root
  if (uri === "" || uri === "/") {
    request.uri = "/index.html";
    return request;
  }

  // look for index.html in url directory
  if (uri.endsWith("/")) {
    request.uri = uri + "index.html";
    return request;
  }

  // /* -> /*/ index.html
  request.uri = uri + "/index.html";
  return request;
}
