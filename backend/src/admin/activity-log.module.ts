import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserActivityLog } from './user-activity-log.entity';
import { ActivityLogService } from './activity-log.service';

/** Global module — ActivityLogService is available in every other module without explicit imports. */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserActivityLog])],
  providers: [ActivityLogService],
  exports: [ActivityLogService],
})
export class ActivityLogModule {}
