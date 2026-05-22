// Types matching PanSou model/*.go

export interface Link {
  type: string;
  url: string;
  password: string;
  datetime?: string;
  work_title?: string;
}

export interface SearchResult {
  message_id: string;
  unique_id: string;
  channel: string;
  datetime: string;
  title: string;
  content: string;
  links: Link[];
  tags?: string[];
  images?: string[];
}

export interface MergedLink {
  url: string;
  password: string;
  note: string;
  datetime: string;
  source?: string;
  images?: string[];
}

export type MergedLinks = Record<string, MergedLink[]>;

export interface SearchResponse {
  total: number;
  results?: SearchResult[];
  merged_by_type?: MergedLinks;
}

export interface ApiResponse {
  code: number;
  message: string;
  data?: any;
}

export interface SearchRequest {
  kw: string;
  channels?: string[];
  conc?: number;
  refresh?: boolean;
  res?: string;
  src?: string;
  plugins?: string[] | null;
  ext?: Record<string, any>;
  cloud_types?: string[];
  filter?: FilterConfig;
}

export interface FilterConfig {
  include?: string[];
  exclude?: string[];
}

export function successResponse(data: any): ApiResponse {
  return { code: 0, message: 'success', data };
}

export function errorResponse(code: number, message: string): ApiResponse {
  return { code, message };
}
