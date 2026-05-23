// ============================================================
// 盘链插件类型定义
// ============================================================

export interface PanlianBaseResponse {
  success: boolean
  message: string
  data?: any
}

export interface PanlianStatus {
  hash: string
  logged_in: boolean
  status: 'pending' | 'active' | 'expired'
  username: string
  login_time: string
  expire_time: string
  expires_in_days: number
}

export interface PanlianStatusResponse extends PanlianBaseResponse {
  data: PanlianStatus
}

export interface PanlianLoginResponse extends PanlianBaseResponse {
  data: {
    username: string
    status: string
  }
}

export interface PanlianLogoutResponse extends PanlianBaseResponse {
  data: {
    status: string
  }
}

export interface PanlianSearchLink {
  type: string
  url: string
  password: string
  datetime?: string
  work_title?: string
}

export interface PanlianSearchResult {
  message_id: string
  unique_id: string
  channel: string
  title: string
  content: string
  datetime: string
  link_count: number
  links: PanlianSearchLink[]
  tags?: string[]
  images?: string[]
}

export interface PanlianSearchResponse extends PanlianBaseResponse {
  data: {
    keyword: string
    total_results: number
    total_links: number
    results: PanlianSearchResult[]
  }
}
