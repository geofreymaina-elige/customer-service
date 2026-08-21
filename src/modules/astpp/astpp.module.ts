import { Module } from '@nestjs/common';
import { AstppAdapterService } from './astpp-adapter.service';

@Module({
  providers: [AstppAdapterService],
  exports: [AstppAdapterService],
})
export class AstppModule {}
