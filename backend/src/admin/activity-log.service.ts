import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserActivityLog, ActivityAction } from './user-activity-log.entity';

@Injectable()
export class ActivityLogService {
  constructor(
    @InjectRepository(UserActivityLog)
    private readonly logRepo: Repository<UserActivityLog>,
  ) {}

  async log(
    userId: number | undefined,
    action: ActivityAction,
    details?: string,
    ip?: string,
  ): Promise<void> {
    try {
      await this.logRepo.save({ userId, action, details, ip });
    } catch {
      // Non-critical — never break the main flow
    }
  }
}
