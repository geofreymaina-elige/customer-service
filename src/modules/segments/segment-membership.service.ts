import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

interface SegmentMembershipRow {
  segmentId: number;
  slug: string;
  name: string;
  priorityRank: number;
  evaluatedAt: string;
  runId: string;
}

interface ClickHouseResponse {
  data: SegmentMembershipRow[];
}

const UINT64_MAX = 18446744073709551615n;

@Injectable()
export class SegmentMembershipService {
  private readonly logger = new Logger(SegmentMembershipService.name);

  constructor(private readonly config: ConfigService) {}

  async getMemberships(astppId: string) {
    this.validateAstppId(astppId);

    try {
      const { data } = await axios.post<ClickHouseResponse>(
        this.getClickHouseUrl(),
        `SELECT
    segment.segment_id AS segmentId,
    segment.slug AS slug,
    segment.name AS name,
    segment.priority_rank AS priorityRank,
    membership.evaluated_at AS evaluatedAt,
    membership.run_id AS runId
FROM analytics.segment_membership_current AS membership
INNER JOIN analytics.dim_segments FINAL AS segment
    ON segment.segment_id = membership.segment_id
WHERE membership.astpp_id = {astpp_id:UInt64}
  AND segment.status = 'active'
ORDER BY segment.priority_rank ASC, segment.segment_id ASC
FORMAT JSON`,
        {
          params: {
            database: this.getRequiredSetting('database'),
            param_astpp_id: astppId,
          },
          auth: {
            username: this.getRequiredSetting('user'),
            password: this.config.get<string>('clickhouse.password') || '',
          },
          timeout: this.getTimeout(),
          headers: { 'content-type': 'text/plain' },
        },
      );

      if (!data || !Array.isArray(data.data)) {
        throw new Error('ClickHouse returned an invalid membership response');
      }

      const memberships = data.data.map((row) => ({
        segmentId: Number(row.segmentId),
        slug: row.slug,
        name: row.name,
        priorityRank: Number(row.priorityRank),
        evaluatedAt: row.evaluatedAt,
        runId: row.runId,
      }));

      return {
        astppId,
        memberships,
        primarySegment: memberships.length > 0
          ? {
              segmentId: memberships[0].segmentId,
              slug: memberships[0].slug,
              name: memberships[0].name,
              priorityRank: memberships[0].priorityRank,
            }
          : null,
      };
    } catch (error) {
      const providerError = error as {
        code?: string;
        response?: { status?: number };
      };
      this.logger.error(JSON.stringify({
        event: 'clickhouse_segment_lookup_failed',
        astppId,
        errorCode: providerError.code || 'CLICKHOUSE_QUERY_ERROR',
        upstreamStatus: providerError.response?.status,
      }));

      throw new ServiceUnavailableException({
        code: 'ANALYTICS_DB_UNAVAILABLE',
        message: 'Segment membership data is temporarily unavailable.',
      });
    }
  }

  private validateAstppId(astppId: string): void {
    if (!/^[1-9]\d*$/.test(astppId)) {
      throw new BadRequestException({
        code: 'INVALID_ASTPP_ID',
        message: 'astppId must be a positive integer.',
      });
    }

    if (BigInt(astppId) > UINT64_MAX) {
      throw new BadRequestException({
        code: 'INVALID_ASTPP_ID',
        message: 'astppId exceeds the supported range.',
      });
    }
  }

  private getClickHouseUrl(): string {
    const protocol = this.getRequiredSetting('protocol');
    const host = this.getRequiredSetting('host');
    const database = this.getRequiredSetting('database');
    const port = this.config.get<number>('clickhouse.port');

    if ((protocol !== 'http' && protocol !== 'https') ||
      database !== 'analytics' ||
      !Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error('Invalid ClickHouse connection configuration');
    }

    const url = new URL(`${protocol}://${host}:${port}`);
    if (!url.hostname || url.username || url.password || url.pathname !== '/') {
      throw new Error('Invalid ClickHouse connection configuration');
    }
    return url.toString();
  }

  private getRequiredSetting(name: string): string {
    const value = this.config.get<string>(`clickhouse.${name}`);
    if (!value?.trim()) {
      throw new Error(`Missing ClickHouse configuration: ${name}`);
    }
    return value.trim();
  }

  private getTimeout(): number {
    const timeout = this.config.get<number>('clickhouse.timeoutMs');
    if (!Number.isInteger(timeout) || timeout < 1) {
      throw new Error('Invalid ClickHouse timeout configuration');
    }
    return timeout;
  }
}
