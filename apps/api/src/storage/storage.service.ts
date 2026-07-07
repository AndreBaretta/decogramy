import { Injectable } from '@nestjs/common';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly client: S3Client;
  private readonly signerClient: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;

  constructor() {
    this.bucket = process.env.MINIO_BUCKET ?? 'photos';
    const internalEndpoint = process.env.MINIO_ENDPOINT ?? 'http://localhost:9000';
    this.publicEndpoint = process.env.MINIO_PUBLIC_ENDPOINT ?? internalEndpoint;
    const credentials = {
      accessKeyId: process.env.MINIO_ACCESS_KEY ?? 'pastatop',
      secretAccessKey: process.env.MINIO_SECRET_KEY ?? 'pastatoppastatop',
    };

    // Server-side operations (existence checks) use the in-cluster endpoint.
    this.client = new S3Client({
      endpoint: internalEndpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
    // Presigned URLs are consumed by the browser, so they must be signed for
    // the PUBLIC endpoint (e.g. localhost:9000), not the docker-internal host.
    this.signerClient = new S3Client({
      endpoint: this.publicEndpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials,
    });
  }

  async createPresignedPutUrl(key: string, contentType: string): Promise<string> {
    const command = new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType });
    return getSignedUrl(this.signerClient, command, { expiresIn: 15 * 60 });
  }

  async objectExists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string): string {
    return `${this.publicEndpoint}/${this.bucket}/${key}`;
  }
}
