import { Module } from '@nestjs/common';
import { CustomerService } from './services/customer.service';
import { CustomerController } from './controllers/customer.controller';
import { SecureJwtService } from '../../core/auth/jwt.service';

@Module({
  controllers: [CustomerController],
  providers: [CustomerService, SecureJwtService],
  exports: [CustomerService],
})
export class CustomersModule {}
