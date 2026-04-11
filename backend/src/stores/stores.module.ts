import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store, StoreOffer } from './store.entity';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { EtmService } from './etm.service';
import { EtmCredential } from './etm-credential.entity';
import { EtmCache } from './etm-cache.entity';
import { User } from '../users/user.entity';
import { ProGuard } from '../auth/guards/pro.guard';

@Module({
  imports: [TypeOrmModule.forFeature([Store, StoreOffer, EtmCredential, EtmCache, User])],
  controllers: [StoresController],
  providers: [StoresService, EtmService, ProGuard],
  exports: [StoresService, EtmService],
})
export class StoresModule {}
