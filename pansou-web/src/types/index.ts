// 搜索结果链接类型
export interface ResultLink {
  type: string;
  url: string;
  password?: string;
}

// 搜索结果项类型
export interface ResultItem {
  message_id?: string;
  unique_id?: string;
  channel?: string;
  datetime?: string;
  title: string;
  content?: string;
  links: ResultLink[];
  tags?: string[];
}

// 按网盘类型合并的结果项
export interface MergedResultItem {
  url: string;
  password?: string;
  note: string;
  datetime?: string;
  source?: string;  // 数据来源（频道或插件名称）
}

// 按网盘类型合并的结果
export interface MergedResults {
  [key: string]: MergedResultItem[];
}

// API响应类型
export interface SearchResponse {
  total: number;
  results: ResultItem[];
  merged_by_type: MergedResults;
}

// 健康状态类型
export interface HealthStatus {
  status: string;
  plugins_enabled: boolean;
  plugin_count: number;
  plugins: string[];
  channels: string[];
  auth_enabled?: boolean;
}

// 登录请求参数
export interface LoginParams {
  username: string;
  password: string;
}

// 登录响应
export interface LoginResponse {
  token: string;
  expires_at: number;
  username: string;
}

// 认证状态
export interface AuthStatus {
  enabled: boolean;
  authenticated: boolean;
}

// 过滤配置类型
export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

// 搜索结果导出格式
export type ExportFormat = 'json' | 'txt';

// 搜索结果导出字段
export type ExportField = 'sequence' | 'title' | 'source' | 'datetime';

// 搜索结果导出设置
export interface ExportSettings {
  format: ExportFormat;
  fields: ExportField[];
  prettyJson: boolean;
  includeFieldLabels: boolean;
  selectedDiskTypes: string[];
  allDiskTypesSelected: boolean;
}

export interface DetectionSettings {
  enabled: boolean;
}

export type LinkHealthState =
  | 'idle'
  | 'pending'
  | 'ok'
  | 'bad'
  | 'locked'
  | 'unsupported'
  | 'uncertain';

export interface LinkHealthRecord {
  state: LinkHealthState;
  summary?: string;
  checked_at: number;
  expires_at: number;
  normalized_url?: string;
}

export interface LinkCheckItem {
  disk_type: string;
  url: string;
  password?: string;
}

export interface LinkCheckResult {
  disk_type: string;
  url: string;
  normalized_url?: string;
  state: LinkHealthState;
  summary?: string;
  cache_hit: boolean;
  checked_at: number;
  expires_at: number;
}

export interface LinkCheckResponse {
  results: LinkCheckResult[];
}

// 导出QQPD相关类型
export * from './qqpd' 
export * from './gying'
export * from './weibo'
export * from './panlian'
