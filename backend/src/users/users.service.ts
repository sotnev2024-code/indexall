import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './user.entity';
import { RegisterDto } from '@indexall/shared';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  async create(createUserDto: RegisterDto): Promise<User> {
    console.log('Register DTO:', createUserDto);
    console.log('Password:', createUserDto.password);
    
    if (!createUserDto.password) {
      throw new Error('Password is required');
    }
    
    const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    
    const user = this.usersRepository.create({
      ...createUserDto,
      password: hashedPassword,
    });

    return this.usersRepository.save(user);
  }

  async findAll(): Promise<User[]> {
    return this.usersRepository.find();
  }

  async findOne(id: number): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.usersRepository.findOne({ where: { email } });
  }

  async update(id: number, updateUserDto: Partial<User>): Promise<User> {
    const user = await this.findOne(id);
    Object.assign(user, updateUserDto);
    return this.usersRepository.save(user);
  }

  async remove(id: number): Promise<void> {
    const user = await this.findOne(id);
    await this.usersRepository.remove(user);
  }

  async updateLastSeen(id: number): Promise<void> {
    await this.usersRepository.update(id, { lastSeen: new Date() });
  }

  async updateProfile(id: number, data: { name?: string; email?: string }): Promise<User> {
    if (data.email) {
      const existing = await this.usersRepository.findOne({ where: { email: data.email } });
      if (existing && existing.id !== id) {
        throw new BadRequestException('Email уже используется другим аккаунтом');
      }
    }
    const updates: Partial<User> = {};
    if (data.name !== undefined) updates.name = data.name.trim();
    if (data.email !== undefined) updates.email = data.email.trim().toLowerCase();
    await this.usersRepository.update(id, updates);
    return this.findOne(id);
  }

  async changePassword(id: number, oldPassword: string, newPassword: string): Promise<void> {
    const user = await this.findOne(id);
    const ok = await bcrypt.compare(oldPassword, user.password);
    if (!ok) throw new BadRequestException('Неверный текущий пароль');
    if (newPassword.length < 6) throw new BadRequestException('Новый пароль должен содержать минимум 6 символов');
    const hashed = await bcrypt.hash(newPassword, 10);
    await this.usersRepository.update(id, { password: hashed });
  }
}
