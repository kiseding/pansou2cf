// 网盘类型映射
export const diskTypeMap: Record<string, string> = {
  'baidu': '百度',
  'aliyun': '阿里',
  '115': '115',
  '123': '123',
  'xunlei': '迅雷',
  'quark': '夸克',
  'guangya': '光鸭',
  'mobile': '移动',
  'tianyi': '天翼',
  'uc': 'UC',
  'pikpak': 'PikPak',
  'ed2k': '电驴',
  'magnet': '磁力',
  'other': '其他'
};

// 获取网盘类型的中文名称
export const getDiskTypeName = (type: string): string => {
  return diskTypeMap[type] || type;
}; 
