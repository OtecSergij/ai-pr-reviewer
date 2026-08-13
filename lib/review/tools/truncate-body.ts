import { BODY_CAP } from "@/lib/review/config";

export const truncateBody = (body: string | null, cap: number = BODY_CAP) => {
  if (!body) {
    return { body, bodyTruncated: false };
  }

  if (body.length > cap) {
    return { body: body.slice(0, cap), bodyTruncated: true };
  }

  return { body, bodyTruncated: false };
};
