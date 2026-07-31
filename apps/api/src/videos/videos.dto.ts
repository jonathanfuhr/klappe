import {
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVideoDto {
  @IsString()
  @MinLength(1, { message: 'Bitte einen Videonamen angeben.' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

export class UpdateVideoDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /** Schalter für den Download aller Fassungen dieses Videos. */
  @IsOptional()
  @IsBoolean()
  downloadsEnabled?: boolean;

  /** KI-Kennzeichnung (Phase 24, Nachtrag); gilt für alle Fassungen. */
  @IsOptional()
  @IsBoolean()
  aiContent?: boolean;

  /** Ersetzt die Auswahl der Arten als Ganzes. */
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  aiKindIds?: string[];
}
