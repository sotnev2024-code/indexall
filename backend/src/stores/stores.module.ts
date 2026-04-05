import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Store, StoreOffer } from './store.entity';
import { StoresService } from './stores.service';
import { StoresController } from './stores.controller';
import { EtmService } from './etm.service';

@Module({
  imports: [TypeOrmModule.forFeature([Store, StoreOffer])],
  controllers: [StoresController],
  providers: [StoresService, EtmService],
  exports: [StoresService, EtmService],
})
export class StoresModule {}
