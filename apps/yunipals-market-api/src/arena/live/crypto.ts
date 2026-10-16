import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";

export function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class StrategyCipher {
  constructor(private readonly key: Buffer) {
    if (key.length !== 32)
      throw new Error("Arena encryption key must contain 32 bytes.");
  }
  seal(context: string, value: unknown) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, nonce);
    cipher.setAAD(Buffer.from(context));
    const data = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final()
    ]);
    return Buffer.concat([nonce, cipher.getAuthTag(), data]).toString("base64");
  }
  open<T>(context: string, value: string): T {
    const data = Buffer.from(value, "base64");
    if (data.length < 29) throw new Error("Invalid encrypted strategy.");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      this.key,
      data.subarray(0, 12)
    );
    cipher.setAAD(Buffer.from(context));
    cipher.setAuthTag(data.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([
        cipher.update(data.subarray(28)),
        cipher.final()
      ]).toString("utf8")
    ) as T;
  }
}
