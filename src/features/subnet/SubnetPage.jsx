import { useMemo, useState } from 'react';
import { Section, btnPrimaryClass, codeClass, inputClass } from '../../components/settings/ui.jsx';
import {
  SUBNET_CIDR_OPTIONS,
  calculateSubnet,
  formatBigInt,
  formatIpRole,
  formatVisibility,
  isValidIpFormat,
} from './subnet.js';

const DEFAULT_IP = '192.168.123.1';
const DEFAULT_PREFIX = 24;

/** 계산 결과를 표에 표시할 행 목록으로 바꿉니다. */
function buildResultRows(result) {
  return [
    { label: 'IP 주소', value: result.ip },
    { label: '퍼블릭/사설 여부', value: formatVisibility(result.visibility) },
    { label: '서브넷마스크', value: result.subnetMask },
    { label: '와일드카드 마스크', value: result.wildcardMask },
    { label: '네트워크 주소', value: result.networkAddress },
    { label: '브로드캐스트 주소', value: result.broadcastAddress },
    { label: 'CIDR 표기', value: result.cidr },
    { label: '주소 클래스', value: result.ipClass },
    { label: '입력된 IP의 역할', value: formatIpRole(result.ipRole) },
    { label: '전체 주소 개수', value: formatBigInt(result.totalAddresses) },
    { label: '사용 가능한 호스트 개수', value: formatBigInt(result.usableHosts) },
    { label: '사용 가능 IP 범위', value: result.usableRange },
  ];
}

const GUIDE_ITEMS = [
  ['IP 주소', '입력한 IPv4 주소입니다.'],
  ['퍼블릭/사설 여부', 'RFC 1918 등 기준으로 사설·공인 IP를 구분합니다.'],
  ['서브넷마스크', '네트워크 부분과 호스트 부분을 나누는 32비트 값입니다.'],
  ['와일드카드 마스크', '서브넷 마스크의 비트 반전 값입니다. ACL 등에 사용됩니다.'],
  ['네트워크 주소', '해당 서브넷의 첫 주소입니다.'],
  ['브로드캐스트 주소', '해당 서브넷의 마지막 주소입니다.'],
  ['CIDR 표기', '네트워크 주소/접두사 형식입니다. (예: 192.168.1.0/24)'],
  ['주소 클래스', '전통적인 A/B/C 클래스 구분입니다.'],
  ['입력된 IP의 역할', '네트워크·브로드캐스트·호스트 IP 여부를 표시합니다.'],
  ['전체 주소 개수', '네트워크·브로드캐스트를 포함한 전체 IP 개수입니다.'],
  ['사용 가능한 호스트 개수', '전체 주소 개수에서 네트워크·브로드캐스트 2개를 뺀 수입니다. (/31, /32 예외)'],
  ['사용 가능 IP 범위', '네트워크·브로드캐스트 주소를 뺀 첫~마지막 호스트 주소입니다.'],
];

/** 서브넷 계산기: IP 와 서브넷마스크를 골라 네트워크·브로드캐스트·호스트 범위 등을 계산합니다. */
export default function SubnetPage() {
  const [ip, setIp] = useState(DEFAULT_IP);
  const [prefix, setPrefix] = useState(DEFAULT_PREFIX);
  const [result, setResult] = useState(/** @type {ReturnType<typeof calculateSubnet> | null} */ (null));
  const [error, setError] = useState('');

  const resultRows = useMemo(() => (result ? buildResultRows(result) : []), [result]);

  const runCalc = () => {
    setError('');
    try {
      if (!isValidIpFormat(ip)) {
        throw new Error('올바른 IPv4 주소를 입력하세요. (예: 192.168.1.10)');
      }
      setResult(calculateSubnet(ip, prefix));
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : '계산에 실패했습니다.');
    }
  };

  return (
    <div className="h-full overflow-auto py-6 pl-6 pr-20">
      <div className="space-y-5">
        <section>
          <h1 className="m-0 text-xl font-semibold text-slate-900">서브넷 계산기</h1>
          <p className="mt-1 text-sm text-slate-500">
            IP 주소와 서브넷을 선택한 뒤 계산을 누르세요. (/32 ~ /0)
          </p>
        </section>

        <Section title="입력">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              runCalc();
            }}
          >
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-600">IP 주소</span>
              <input
                type="text"
                className={`${inputClass} w-44 font-mono`}
                value={ip}
                onChange={(event) => setIp(event.target.value)}
                placeholder="192.168.123.1"
                autoComplete="off"
                spellCheck={false}
              />
            </label>
            <label className="flex flex-col gap-2">
              <span className="text-xs font-medium text-slate-600">서브넷</span>
              <select
                className={`${inputClass} w-56 cursor-pointer font-mono`}
                value={prefix}
                onChange={(event) => setPrefix(Number(event.target.value))}
                aria-label="서브넷 선택"
              >
                {SUBNET_CIDR_OPTIONS.map((option) => (
                  <option key={option.prefix} value={option.prefix}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={btnPrimaryClass}>
              계산
            </button>
          </form>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </Section>

        {result ? (
          <Section title="계산 결과">
            <table className="w-full border-collapse text-sm" aria-live="polite">
              <tbody>
                {resultRows.map((row) => (
                  <tr key={row.label}>
                    <th
                      scope="row"
                      className="w-2/5 border border-slate-300 bg-slate-50 px-3 py-2 text-left font-semibold text-slate-700"
                    >
                      {row.label}
                    </th>
                    <td className="border border-slate-300 px-3 py-2 font-mono text-slate-900">{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>
        ) : null}

        <Section title="결과 해설">
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            {GUIDE_ITEMS.map(([term, text]) => (
              <li key={term}>
                <strong className="font-semibold text-slate-800">{term}</strong> — {text}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="서브넷(Subnet)이란?">
          <p className="m-0 text-sm leading-relaxed text-slate-600">
            하나의 IP 네트워크를 더 작은 구간으로 나누는 기법입니다. 부서·층·서비스별로 주소를 구분하고,
            브로드캐스트 범위를 줄여 보안과 관리 효율을 높일 수 있습니다.
          </p>
        </Section>

        <Section title="CIDR이란?">
          <p className="m-0 text-sm leading-relaxed text-slate-600">
            Classless Inter-Domain Routing의 약자로, IP 주소 뒤에 <code className={codeClass}>/숫자</code> 형태로
            서브넷 크기를 표현합니다. 숫자가 클수록 서브넷이 작아집니다. (예: /24 → 256개 주소)
          </p>
        </Section>

        <Section title="활용 예시">
          <ul className="m-0 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-slate-600">
            <li>부서·팀별 VLAN 또는 IP 대역 분리</li>
            <li>서버·클라이언트·관리망 구역 설계</li>
            <li>DMZ, 내부망, VPN 대역 계획</li>
            <li>IP 주소 부족 시 세분화(/25, /26 등) 검토</li>
          </ul>
        </Section>

        <div className="rounded-lg border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          /30·/31은 라우터 간 링크에, /24는 소규모 사무 LAN에 자주 사용됩니다. 실제 설계 시 조직 정책과 장비 지원
          범위를 함께 확인하세요.
        </div>
      </div>
    </div>
  );
}
