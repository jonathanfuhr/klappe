import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MinLength(1, { message: 'Bitte einen Projektnamen angeben.' })
  @MaxLength(200)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}

/**
 * Kunden umbenennen. `nach` weglassen heißt: den Namen von allen Projekten
 * entfernen – die Projekte bleiben bestehen, nur das Kundenfeld wird leer.
 */
export class RenameCustomerDto {
  @IsString()
  @MinLength(1, { message: 'Bitte den bisherigen Kundennamen angeben.' })
  @MaxLength(200)
  von!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  nach?: string;
}

export class UpdateProjectDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  customer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
}
