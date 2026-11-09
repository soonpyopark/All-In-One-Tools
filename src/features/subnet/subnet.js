/**
 * IPv4 서브넷 계산 로직 (MyPortal 의 CalcSubnet 에서 가져와 JS 로 옮김).
 * 네트워크 통신 없이 브라우저(화면) 안에서만 계산합니다.
 */

const IP_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;

export function isValidIpFormat(value) {
  const text = String(value ?? '').trim();
  if (!IP_RE.test(text)) return false;
  return text.split('.').every((part) => {
    const n = Number(part);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function ipToInt(ip) {
  const parts = String(ip ?? '').trim().split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => p < 0 || p > 255 || !Number.isInteger(p))) {
    throw new Error('올바른 IPv4 주소를 입력하세요. (예: 192.168.1.10)');
  }
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

export function intToIp(value) {
  const n = value >>> 0;
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
}

export function prefixToMask(prefix) {
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) {
    throw new Error('CIDR 접두사는 0~32 사이여야 합니다.');
  }
  if (prefix === 0) return 0;
  return ~((1 << (32 - prefix)) - 1) >>> 0;
}

/** 255.255.255.255 (/32) ~ 0.0.0.0 (/0), 내림차순 */
export const SUBNET_CIDR_OPTIONS = Array.from({ length: 33 }, (_, i) => {
  const prefix = 32 - i;
  const mask = intToIp(prefixToMask(prefix));
  return { prefix, mask, label: `${mask} (/${prefix})` };
});

export function getIpClass(firstOctet) {
  if (firstOctet < 128) return 'A';
  if (firstOctet < 192) return 'B';
  if (firstOctet < 224) return 'C';
  if (firstOctet < 240) return 'D';
  return 'E';
}

/** @returns {'공인' | '사설' | '루프백' | '링크-로컬' | '멀티캐스트' | '예약'} */
export function getIpVisibility(ipInt) {
  const first = (ipInt >>> 24) & 255;
  const second = (ipInt >>> 16) & 255;

  if (first === 10) return '사설';
  if (first === 172 && second >= 16 && second <= 31) return '사설';
  if (first === 192 && second === 168) return '사설';
  if (first === 127) return '루프백';
  if (first === 169 && second === 254) return '링크-로컬';
  if (first >= 224 && first <= 239) return '멀티캐스트';
  if (first >= 240) return '예약';
  return '공인';
}

function getAddressCounts(prefix) {
  const total = 1n << BigInt(32 - prefix);
  if (prefix === 32) return { total: 1n, usable: 1n };
  if (prefix === 31) return { total: 2n, usable: 2n };
  const usable = total > 2n ? total - 2n : 0n;
  return { total, usable };
}

function getUsableRange(network, broadcast, prefix) {
  if (prefix >= 31) return `${intToIp(network)} ~ ${intToIp(broadcast)}`;
  if (prefix === 0) return '0.0.0.1 ~ 255.255.255.254';
  const firstHost = network + 1;
  const lastHost = broadcast - 1;
  if (firstHost > lastHost) return '(없음)';
  return `${intToIp(firstHost)} ~ ${intToIp(lastHost)}`;
}

function getIpRole(ipInt, network, broadcast) {
  if (ipInt === network) return '네트워크 주소';
  if (ipInt === broadcast) return '브로드캐스트 주소';
  return '호스트 주소';
}

/**
 * @param {string} ip
 * @param {number} prefix
 */
export function calculateSubnet(ip, prefix) {
  const ipInt = ipToInt(ip);
  const maskInt = prefixToMask(prefix);
  const network = (ipInt & maskInt) >>> 0;
  const broadcast = (network | (~maskInt >>> 0)) >>> 0;
  const wildcard = ~maskInt >>> 0;
  const { total, usable } = getAddressCounts(prefix);

  return {
    ip: intToIp(ipInt),
    visibility: getIpVisibility(ipInt),
    subnetMask: intToIp(maskInt),
    wildcardMask: intToIp(wildcard),
    networkAddress: intToIp(network),
    broadcastAddress: intToIp(broadcast),
    cidr: `${intToIp(network)}/${prefix}`,
    prefix,
    ipClass: getIpClass((ipInt >>> 24) & 255),
    ipRole: getIpRole(ipInt, network, broadcast),
    totalAddresses: total,
    usableHosts: usable < 0n ? 0n : usable,
    usableRange: getUsableRange(network, broadcast, prefix),
  };
}

const VISIBILITY_LABELS = {
  공인: '공인 IP',
  사설: '사설 IP',
  루프백: '루프백 IP',
  '링크-로컬': '링크-로컬 IP',
  멀티캐스트: '멀티캐스트 IP',
  예약: '예약 IP',
};

const IP_ROLE_LABELS = {
  '네트워크 주소': '네트워크 IP',
  '브로드캐스트 주소': '브로드캐스트 IP',
  '호스트 주소': '호스트 IP',
};

export const formatVisibility = (visibility) => VISIBILITY_LABELS[visibility] ?? visibility;
export const formatIpRole = (role) => IP_ROLE_LABELS[role] ?? role;
export const formatBigInt = (value) => value.toString();
