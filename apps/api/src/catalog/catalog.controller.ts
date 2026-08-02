import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AccessTokenGuard } from '../rbac/access-token.guard';
import { PermissionGuard } from '../rbac/permission.guard';
import { RequirePermission } from '../rbac/rbac.decorators';
import { RBAC_PERMISSIONS } from '../rbac/rbac.constants';
import {
  CreateProductDto,
  CreateProductPriceDto,
  UpdateProductDto,
} from './catalog.dto';
import { CatalogService } from './catalog.service';

@Controller('stores/:storeId/catalog')
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get()
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_READ)
  browse(@Param('storeId') storeId: string) {
    return this.catalogService.browse(storeId);
  }

  @Get('products')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  list(@Param('storeId') storeId: string) {
    return this.catalogService.list(storeId);
  }

  @Post('products')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  create(@Param('storeId') storeId: string, @Body() body: CreateProductDto) {
    return this.catalogService.createProduct(storeId, body);
  }

  @Get('products/:productId')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  get(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ) {
    return this.catalogService.getProduct(storeId, productId);
  }

  @Patch('products/:productId')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  update(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() body: UpdateProductDto,
  ) {
    return this.catalogService.updateProduct(storeId, productId, body);
  }

  @Get('products/:productId/prices')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  prices(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
  ) {
    return this.catalogService.getPriceHistory(storeId, productId);
  }

  @Post('products/:productId/prices')
  @UseGuards(AccessTokenGuard, PermissionGuard)
  @RequirePermission(RBAC_PERMISSIONS.CATALOG_MANAGE, {
    storeIdParam: 'storeId',
  })
  createPrice(
    @Param('storeId') storeId: string,
    @Param('productId') productId: string,
    @Body() body: CreateProductPriceDto,
  ) {
    return this.catalogService.createPrice(storeId, productId, body);
  }
}
