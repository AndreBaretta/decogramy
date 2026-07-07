import { Injectable } from '@nestjs/common';
import { Readable } from 'node:stream';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';

export interface ObjectMeta {
  contentType?: string;
  contentLength?: number;
}

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly bucket = process.env.MINIO_BUCKET ?? 'photos';

  constructor() {
    this.client = new S3Client({
      endpoint: process.env.MINIO_ENDPOINT ?? 'http://localhost:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'pastatop',
        secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'pastatoppastatop',
      },
    });
  }

  async head(key: string): Promise<ObjectMeta | null> {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { contentType: res.ContentType, contentLength: res.ContentLength };
    } catch {
      return null;
    }
  }

  async getBytes(key: string): Promise<Buffer> {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    const body = res.Body as Readable;
    const chunks: Buffer[] = [];
    for await (const chunk of body) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async putBytes(key: string, bytes: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
  }

  /** Idempotent: deleting a missing object is not an error. */
  async deleteObject(key: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
    } catch {
      /* tolerate already-missing objects */
    }
  }
}
