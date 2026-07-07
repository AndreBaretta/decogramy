import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class CreatePostDto {
  @IsIn(ALLOWED_MIME_TYPES, { message: 'mimeType must be one of image/jpeg, image/png, image/webp' })
  mimeType!: string;

  @IsInt()
  @Min(1)
  @Max(MAX_UPLOAD_BYTES)
  sizeBytes!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2200)
  caption?: string;
}
