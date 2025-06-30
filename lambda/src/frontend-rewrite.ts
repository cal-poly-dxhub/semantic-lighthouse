interface CloudFrontRequestEvent {
  request: {
    uri: string;
  };
}

// middleman because of s3 and nextjs static site file descriptions (appends .html or index.html if not present)
export const handler = (event: CloudFrontRequestEvent): { uri: string } => {
  const request = event.request;
  const uri = request.uri;

  if (uri.endsWith("/")) {
    request.uri += "index.html";
  } else if (!uri.includes(".")) {
    request.uri += ".html";
  }

  return request;
};
