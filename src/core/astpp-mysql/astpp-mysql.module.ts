import { Module, Global } from '@nestjs/common';
import { AstppMysqlService } from './astpp-mysql.service';

@Global()
@Module({
  providers: [AstppMysqlService],
  exports: [AstppMysqlService],
})
export class AstppMysqlModule {}
