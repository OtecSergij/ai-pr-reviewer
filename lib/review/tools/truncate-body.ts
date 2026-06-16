const BODY_CAP = 10_000;

export const truncateBody = (body: string | null) => {
  if (!body) {
    return { body, bodyTruncated: false };
  }

  if (body.length > BODY_CAP) {
    return { body: body.slice(0, BODY_CAP), bodyTruncated: true };
  }

  return { body, bodyTruncated: false };
};
