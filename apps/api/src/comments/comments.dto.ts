import { IsInt, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';

export class CreateCommentDto {
  @IsString()
  @MinLength(1, { message: 'Der Kommentar darf nicht leer sein.' })
  @MaxLength(5000)
  body!: string;

  /**
   * Frame-Index im Video (0 = erstes Bild). Fehlt der Wert, ist es ein
   * allgemeiner Kommentar ohne Zeitbezug.
   */
  @IsOptional()
  @IsInt({ message: 'Der Frame muss eine ganze Zahl sein.' })
  @Min(0)
  frame?: number;

  @IsOptional()
  @IsUUID('4', { message: 'Die Antwort bezieht sich auf keinen gültigen Kommentar.' })
  parentId?: string;
}

export class UpdateCommentDto {
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  body!: string;
}
