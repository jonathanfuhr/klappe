import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import type { BackupFileDto, BackupSettingsDto } from '@klappe/shared';
import {
  MAX_BACKUP_INTERVAL_HOURS,
  MAX_BACKUP_RETENTION_DAYS,
  MIN_BACKUP_INTERVAL_HOURS,
} from '@klappe/shared';
import { IsBoolean, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { Roles } from '../auth/auth.decorators';
import { BackupService } from './backup.service';

class UpdateBackupDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsInt()
  @Min(MIN_BACKUP_INTERVAL_HOURS)
  @Max(MAX_BACKUP_INTERVAL_HOURS)
  intervalHours?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_BACKUP_RETENTION_DAYS)
  retentionDays?: number;
}

class RestoreDto {
  @IsString()
  @MaxLength(200)
  name!: string;
}

/**
 * Datenbanksicherung (Phase 23) – durchweg Admin-Sache.
 *
 * Auch das Lesen: Die Liste verrät, wie oft gesichert wird und wie groß die
 * Datenbank ist, und das Wiederherstellen ist der folgenreichste Knopf im
 * ganzen Haus.
 */
@Roles('ADMIN')
@Controller('v1/settings/backup')
export class BackupController {
  constructor(private readonly backupService: BackupService) {}

  @Get()
  getSettings(): Promise<BackupSettingsDto> {
    return this.backupService.getSettings();
  }

  @Put()
  updateSettings(@Body() dto: UpdateBackupDto): Promise<BackupSettingsDto> {
    return this.backupService.updateSettings(dto);
  }

  @Get('files')
  list(): Promise<BackupFileDto[]> {
    return this.backupService.list();
  }

  /** Jetzt sichern, unabhängig vom Zeitplan. */
  @Post('run')
  run(): Promise<BackupFileDto> {
    return this.backupService.run();
  }

  /**
   * Wiederherstellen. Der vorherige Stand wird zuvor selbst gesichert – wer
   * die falsche Datei erwischt, hat sonst keinen Weg zurück.
   */
  @Post('restore')
  restore(@Body() dto: RestoreDto): Promise<{ sicherungVorher: string }> {
    return this.backupService.restore(dto.name);
  }

  @Delete('files/:name')
  remove(@Param('name') name: string): Promise<void> {
    return this.backupService.remove(name);
  }
}
