import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_LAUNCHER_COLOR,
  LAUNCHER_COLOR_PALETTE,
  launcherColorGradient,
  normalizeLauncherColorId,
} from '../../../shared/launcherColors.js';
import { Section, btnClass, btnPrimaryClass, inputClass } from '../../components/settings/ui.jsx';
import { useDialog } from '../../context/DialogContext.jsx';
import { api, getNative } from '../../lib/apiClient.js';
import { canResolveDroppedFiles, pathsFromDropEvent } from '../../lib/dropPaths.js';
import { showExportDone } from '../../lib/exportDone.jsx';

/** 탐색기·바탕화면에서 파일을 끌어오는 중인지 */
function isExternalFileDrag(event) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}

/**
 * @typedef {{
 *   id: string,
 *   type: 'app' | 'url' | 'folder' | 'file',
 *   title: string,
 *   target: string,
 *   icon: string,
 *   group: 'work' | 'personal' | 'general',
 *   color: string,
 * }} LauncherItem
 */

const TYPE_LABEL = {
  app: '프로그램',
  url: '웹사이트',
  folder: '폴더',
  file: '파일',
};

const TYPE_ICON = {
  app: '💻',
  url: '🌐',
  folder: '📁',
  file: '📄',
};

const GROUP_LABEL = {
  all: '전체',
  work: '업무',
  personal: '개인',
  general: '공통',
};

const ICON_PRESETS = [
  // 기기·개발
  '💻', '🖥️', '⌨️', '🖱️', '💾', '💿', '📀', '🖨️', '📠', '📡',
  '🛰️', '📲', '📱', '☎️', '📞', '🔋', '🔌', '💡', '🔦', '🕯️',
  '⚙️', '🛠️', '🔧', '🔨', '🪛', '🔩', '🧰', '🧲', '🧪', '🔬',
  '🔭', '🧬', '💉', '🩹', '🩺', '🧮', '📏', '📐', '📎', '🖇️',
  '📌', '📍', '🔖', '🏷️', '🗂️', '📂', '📁', '📄', '📃', '📑',
  '🗞️', '📰', '📓', '📔', '📒', '📕', '📗', '📘', '📙', '📚',
  '📖', '🧾', '📜', '📝', '✏️', '✒️', '🖊️', '🖋️', '🖌️', '🖍️',
  // 웹·보안·클라우드
  '🌐', '🔗', '🔓', '🔒', '🔐', '🔑', '🗝️', '🛡️', '☁️', '⛅',
  '🌤️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '💨', '💧', '🔥', '💥',
  // 업무·일정·소통
  '📅', '📆', '🗓️', '📇', '🗃️', '🗄️', '⏰', '⏱️', '⏲️', '🕰️',
  '⌛', '⏳', '⌚', '📧', '📨', '📩', '📤', '📥', '📦', '📫',
  '📪', '📬', '📭', '📮', '🗳️', '💬', '💭', '🗯️', '🗨️', '📢',
  '📣', '🔔', '🔕', '📯', '🎤', '🎧', '📻', '📺', '📷', '📸',
  '📹', '🎥', '📽️', '🎞️', '🎬', '🎦', '🎵', '🎶', '🎼', '🎹',
  '🥁', '🎷', '🎺', '🎸', '🪕', '🎻', '🎲', '♠️', '♥️', '♦️',
  '♣️', '🃏', '🀄', '🎴', '🎯', '🎳', '🎮', '🕹️', '🎰', '🧩',
  // 금융·쇼핑
  '💰', '💴', '💵', '💶', '💷', '💸', '💳', '🧾', '💹', '📈',
  '📉', '📊', '🏦', '🏧', '💱', '💲', '🪙', '💎', '⚖️', '🛒',
  '🛍️', '🧺', '🎁', '🎀', '🎊', '🎉', '🎈', '🎆', '🎇', '✨',
  // 장소·건물
  '🏠', '🏡', '🏢', '🏣', '🏤', '🏥', '🏦', '🏨', '🏩', '🏪',
  '🏫', '🏬', '🏭', '🏯', '🏰', '💒', '🗼', '🗽', '⛪', '🕌',
  '🛕', '🕍', '⛩️', '🕋', '⛲', '⛺', '🌁', '🌃', '🏙️', '🌄',
  '🌅', '🌆', '🌇', '🌉', '♨️', '🎠', '🎡', '🎢', '💈', '🎪',
  // 교통
  '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒', '🚐',
  '🛻', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵',
  '🏍️', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟',
  '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇',
  '🚊', '🚉', '✈️', '🛫', '🛬', '🛩️', '💺', '🚁', '🚟', '🚠',
  '🚀', '🛸', '⛵', '🛶', '🚤', '🛳️', '⛴️', '🛥️', '🚢', '⚓',
  '⛽', '🚧', '🚦', '🚥', '🚏', '🗺️', '🗿', '🧭', '🧳', '🎒',
  // 자연·날씨·식물
  '🌍', '🌎', '🌏', '🌐', '🗺️', '🗾', '🧭', '⛰️', '🏔️', '🗻',
  '🌋', '🏕️', '🏖️', '🏜️', '🏝️', '🏞️', '🏟️', '🏛️', '🏗️', '🧱',
  '🪨', '🪵', '🛖', '🏘️', '🏚️', '🌳', '🌲', '🌴', '🌵', '🌾',
  '🌿', '☘️', '🍀', '🍁', '🍂', '🍃', '🪴', '🌱', '🌸', '💮',
  '🏵️', '🌹', '🥀', '🌺', '🌻', '🌼', '🌷', '🌞', '🌝', '🌛',
  '🌜', '🌚', '🌕', '🌖', '🌗', '🌘', '🌑', '🌒', '🌓', '🌔',
  '🌙', '🌎', '⭐', '🌟', '💫', '✨', '☄️', '☀️', '🌤️', '⛅',
  '🌥️', '☁️', '🌦️', '🌧️', '⛈️', '🌩️', '🌨️', '❄️', '☃️', '⛄',
  '🌬️', '💨', '🌪️', '🌫️', '🌈', '☂️', '☔', '⚡', '🔥', '💧',
  '🌊', '🎃', '🎄', '🎆', '🎇', '✨', '🎈', '🎉', '🎊', '🎋',
  // 동물
  '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐻‍❄️', '🐨',
  '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒',
  '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇',
  '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞',
  '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷️', '🕸️', '🦂', '🐢',
  '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡',
  '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓',
  '🦍', '🦧', '🦣', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘',
  '🦬', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐',
  '🦌', '🐕', '🐩', '🦮', '🐕‍🦺', '🐈', '🐈‍⬛', '🪶', '🦅', '🦤',
  '🦚', '🦜', '🦢', '🦩', '🕊️', '🐇', '🦝', '🦨', '🦡', '🦫',
  '🦦', '🦥', '🐁', '🐀', '🐿️', '🦔',
  // 음식·음료
  '🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐',
  '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑',
  '🥦', '🥬', '🥒', '🌶️', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅',
  '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧀', '🥚', '🍳',
  '🧈', '🥞', '🧇', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔',
  '🍟', '🍕', '🫓', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗',
  '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟',
  '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡',
  '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬',
  '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '☕',
  '🫖', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷',
  '🥃', '🍸', '🍹', '🧉', '🍾', '🧊', '🥄', '🍴', '🍽️', '🥣',
  '🥡', '🥢', '🧂',
  // 스포츠·활동
  '⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱',
  '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳',
  '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷',
  '⛸️', '🥌', '🎿', '⛷️', '🏂', '🪂', '🏋️', '🤼', '🤸', '⛹️',
  '🤺', '🤾', '🏌️', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗',
  '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🏵️', '🎗️',
  '🎫', '🎟️', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧',
  '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻',
  '🎲', '♟️', '🎯', '🎳', '🎮', '🎰', '🧩',
  // 의류·소지품
  '👓', '🕶️', '🥽', '🥼', '🦺', '👔', '👕', '👖', '🧣', '🧤',
  '🧥', '🧦', '👗', '👘', '🥻', '🩱', '🩲', '🩳', '👙', '👚',
  '👛', '👜', '👝', '🛍️', '🎒', '🩴', '👞', '👟', '🥾', '🥿',
  '👠', '👡', '🩰', '👢', '👑', '👒', '🎩', '🎓', '🧢', '⛑️',
  '🪖', '💄', '💍', '💼', '🛡️',
  // 기호·상태
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔',
  '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️',
  '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐',
  '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐',
  '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳',
  '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️',
  '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️',
  '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️',
  '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓',
  '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️',
  '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠',
  'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🛂', '🛃',
  '🛄', '🛅', '♂️', '♀️', '⚧️', '✖️', '➕', '➖', '➗', '♾️',
  '‼️', '⁉️', '❓', '❔', '❕', '❗', '〰️', '💱', '💲', '⚕️',
  '♻️', '⚜️', '🔱', '📛', '🔰', '⭕', '✅', '☑️', '✔️', '❌',
  '❎', '➰', '➿', '〰', '➰', '➿', '〽️', '✳️', '✴️', '❇️',
  '©️', '®️', '™️', '#️⃣', '*️⃣', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣',
  '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔠', '🔡', '🔢', '🔣',
  '🔤', '🅰️', '🆎', '🅱️', '🆑', '🆒', '🆓', 'ℹ️', '🆔', 'Ⓜ️',
  '🆕', '🆖', '🅾️', '🆗', '🅿️', '🆘', '🆙', '🆚', '🈁', '🈂️',
  '🈷️', '🈶', '🈯', '🉐', '🈹', '🈚', '🈲', '🉑', '🈸', '🈴',
  '🈳', '㊗️', '㊙️', '🈺', '🈵', '🔴', '🟠', '🟡', '🟢', '🔵',
  '🟣', '🟤', '⚫', '⚪', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪',
  '🟫', '⬛', '⬜', '◼️', '◻️', '◾', '◽', '▪️', '▫️', '🔶',
  '🔷', '🔸', '🔹', '🔺', '🔻', '💠', '🔘', '🔳', '🔲', '▪️',
  '🏳️', '🏴', '🏁', '🚩', '🏳️‍🌈', '🏴‍☠️',
  // 사람·표정
  '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃',
  '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '☺️', '😚',
  '😙', '🥲', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗', '🤭',
  '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄',
  '😬', '🤥', '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕',
  '🤢', '🤮', '🤧', '🥵', '🥶', '🥴', '😵', '🤯', '🤠', '🥳',
  '🥸', '😎', '🤓', '🧐', '😕', '😟', '🙁', '☹️', '😮', '😯',
  '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭',
  '😱', '😖', '😣', '😞', '😓', '😩', '😫', '🥱', '😤', '😡',
  '😠', '🤬', '😈', '👿', '💀', '☠️', '💩', '🤡', '👹', '👺',
  '👻', '👽', '👾', '🤖', '😺', '😸', '😹', '😻', '😼', '😽',
  '🙀', '😿', '😾', '🙈', '🙉', '🙊', '💋', '💌', '💘', '💝',
  '💖', '💗', '💓', '💞', '💕', '💟', '❣️', '💔', '❤️', '🧡',
  '💛', '💚', '💙', '💜', '🤎', '🖤', '🤍', '💯', '💢', '💥',
  '💫', '💦', '💨', '🕳️', '💣', '💬', '👁️‍🗨️', '🗨️', '🗯️', '💭',
  '💤', '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️',
  '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
  '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
  '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶',
  '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁️',
  '👅', '👄', '👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔',
  '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋',
  '🧏', '🙇', '🤦', '🤷', '👮', '🕵️', '💂', '🥷', '👷', '🤴',
  '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👼', '🎅',
  '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟',
  '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴️', '👯',
  '🧘', '🛀', '🛌', '👤', '👥', '🫂', '👪', '🗣️', '👤', '👥',
];

/** 중복 제거한 아이콘 목록 */
const ICON_PRESET_UNIQUE = [...new Set(ICON_PRESETS)];

/** @returns {Partial<LauncherItem> & { type: LauncherItem['type'], group: LauncherItem['group'], color: string }} */
function blankDraft(type) {
  return {
    id: '',
    type,
    title: '',
    target: '',
    icon: TYPE_ICON[type],
    group: 'general',
    color: DEFAULT_LAUNCHER_COLOR,
  };
}

/**
 * 런처: 프로그램·웹사이트·폴더·파일 바로가기 (그룹·아이콘·검색).
 * @param {{
 *   editItemId?: string | null,
 *   onEditItemHandled?: () => void,
 * }} [props]
 */
export default function LauncherPage({ editItemId = null, onEditItemHandled } = {}) {
  const dialog = useDialog();
  const native = getNative();
  const [items, setItems] = useState(/** @type {LauncherItem[]} */ ([]));
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(/** @type {string | null} */ (null));
  const [draft, setDraft] = useState(
    /** @type {(Partial<LauncherItem> & { type: LauncherItem['type'], group?: LauncherItem['group'] }) | null} */ (null),
  );
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState(/** @type {'all' | LauncherItem['group']} */ ('all'));

  const dragIdRef = useRef(/** @type {string | null} */ (null));
  const didDragRef = useRef(false);
  const [draggingId, setDraggingId] = useState(/** @type {string | null} */ (null));
  const [overId, setOverId] = useState(/** @type {string | null} */ (null));
  const [fileDropOver, setFileDropOver] = useState(false);
  const [addingDrops, setAddingDrops] = useState(false);

  useEffect(() => {
    let alive = true;
    api('launcher.list')
      .then((res) => {
        if (!alive) return;
        setItems(Array.isArray(res?.items) ? res.items : []);
      })
      .catch((err) => {
        if (!alive) return;
        void dialog.alert({
          title: '런처',
          body: err instanceof Error ? err.message : '목록을 불러오지 못했습니다.',
        });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [dialog]);

  // 플로팅 런처에서 추가·삭제해도 메인 목록을 바로 맞춥니다.
  useEffect(() => {
    if (!native?.onLauncherItemsChanged) return undefined;
    return native.onLauncherItemsChanged((payload) => {
      const next = Array.isArray(payload?.items) ? payload.items : null;
      if (!next) return;
      setItems(/** @type {LauncherItem[]} */ (next));
      setDraft((current) => {
        if (!current?.id) return current;
        return next.some((entry) => entry?.id === current.id) ? current : null;
      });
    });
  }, [native]);

  // 플로팅 런처 ✎ → 메인 런처 편집 폼 열기
  useEffect(() => {
    const id = String(editItemId ?? '').trim();
    if (!id) return undefined;
    let alive = true;
    void (async () => {
      let list = items;
      if (!list.some((item) => item.id === id)) {
        try {
          const res = await api('launcher.list');
          list = Array.isArray(res?.items) ? res.items : [];
          if (alive) setItems(list);
        } catch {
          // 목록을 못 읽어도 아래 안내로 처리
        }
      }
      if (!alive) return;
      const item = list.find((entry) => entry.id === id);
      if (item) {
        setDraft({ ...item });
        setGroupFilter('all');
        setQuery('');
      } else {
        void dialog.alert({ title: '런처', body: '편집할 바로가기를 찾지 못했습니다.' });
      }
      onEditItemHandled?.();
    })();
    return () => {
      alive = false;
    };
    // items 는 의도적으로 deps 에서 제외 (요청 id 기준으로 한 번만 처리)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editItemId]);

  const filteredItems = useMemo(() => {
    const q = query.trim().toLowerCase();
    return items.filter((item) => {
      if (groupFilter !== 'all' && item.group !== groupFilter) return false;
      if (!q) return true;
      const hay = `${item.title}\n${item.target}\n${TYPE_LABEL[item.type]}\n${GROUP_LABEL[item.group] ?? ''}`.toLowerCase();
      return hay.includes(q);
    });
  }, [items, query, groupFilter]);

  const groupCounts = useMemo(() => {
    /** @type {Record<string, number>} */
    const counts = { all: items.length, work: 0, personal: 0, general: 0 };
    for (const item of items) {
      if (item.group === 'work' || item.group === 'personal' || item.group === 'general') {
        counts[item.group] += 1;
      } else {
        counts.general += 1;
      }
    }
    return counts;
  }, [items]);

  const persistOrder = async (nextItems) => {
    setItems(nextItems);
    try {
      const res = await api('launcher.save', { items: nextItems });
      setItems(Array.isArray(res?.items) ? res.items : nextItems);
    } catch (err) {
      void dialog.alert({
        title: '순서 저장 실패',
        body: err instanceof Error ? err.message : '순서를 저장하지 못했습니다.',
      });
    }
  };

  const moveBefore = (fromId, toId) => {
    if (!fromId || !toId || fromId === toId) return;
    const ids = items.map((item) => item.id);
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0) return;
    const next = [...items];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    void persistOrder(next);
  };

  /** 바탕화면·탐색기에서 끌어다 놓은 바로가기·파일·폴더를 종류별로 바로 추가합니다. */
  const addDroppedFiles = async (event) => {
    setFileDropOver(false);
    if (addingDrops) return;
    if (!canResolveDroppedFiles()) {
      void dialog.alert({
        title: '런처',
        body: '파일 끌어놓기를 쓰려면 앱을 다시 시작해 주세요.',
      });
      return;
    }
    const paths = pathsFromDropEvent(event);
    if (paths.length === 0) return;

    setAddingDrops(true);
    try {
      const res = await api('launcher.addFromPaths', { paths });
      setItems(Array.isArray(res?.items) ? res.items : items);
      const added = Number(res?.added) || 0;
      const skipped = Number(res?.skipped) || 0;
      const failures = Array.isArray(res?.failures) ? res.failures : [];
      if (added === 0 && failures.length > 0) {
        void dialog.alert({
          title: '추가 실패',
          body: failures.slice(0, 5).join('\n'),
        });
      } else if (added > 0 && (skipped > 0 || failures.length > 0)) {
        void dialog.alert({
          title: '일부 추가됨',
          body: `${added}개 추가 · 건너뜀 ${skipped}개${
            failures.length ? `\n${failures.slice(0, 3).join('\n')}` : ''
          }`,
        });
      }
    } catch (err) {
      void dialog.alert({
        title: '추가 실패',
        body: err instanceof Error ? err.message : '끌어다 놓은 항목을 추가하지 못했습니다.',
      });
    } finally {
      setAddingDrops(false);
    }
  };

  const openFloatingLauncher = async () => {
    try {
      await api('launcher.floating.show');
    } catch (err) {
      void dialog.alert({
        title: '플로팅 런처',
        body: err instanceof Error ? err.message : '플로팅 런처를 열지 못했습니다.',
      });
    }
  };

  const openItem = async (item) => {
    if (busyId) return;
    setBusyId(item.id);
    try {
      await api('launcher.open', { id: item.id });
    } catch (err) {
      void dialog.alert({
        title: '실행 실패',
        body: err instanceof Error ? err.message : '바로가기를 열지 못했습니다.',
      });
    } finally {
      setBusyId(null);
    }
  };

  const removeItem = async (item) => {
    const ok = await dialog.confirm({
      title: '바로가기 삭제',
      body: `「${item.title}」을(를) 삭제할까요?`,
      confirmLabel: '삭제',
      confirmVariant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await api('launcher.remove', { id: item.id });
      setItems(Array.isArray(res?.items) ? res.items : items.filter((entry) => entry.id !== item.id));
      if (draft?.id === item.id) setDraft(null);
    } catch (err) {
      void dialog.alert({
        title: '삭제 실패',
        body: err instanceof Error ? err.message : '삭제하지 못했습니다.',
      });
    }
  };

  const startAdd = async (type) => {
    if (type === 'url') {
      setDraft({
        ...blankDraft('url'),
        group: groupFilter === 'all' ? 'general' : groupFilter,
      });
      return;
    }

    const native = getNative();
    if (type === 'folder') {
      if (!native?.pickDirectory) {
        void dialog.alert({ title: '폴더 추가', body: '폴더 선택을 사용할 수 없습니다.' });
        return;
      }
      const picked = await native.pickDirectory({ title: '폴더 선택', memoryKey: 'launcher.folder' });
      if (picked?.canceled || !picked?.path) return;
      const base = String(picked.path).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || picked.path;
      setDraft({
        ...blankDraft('folder'),
        title: base,
        target: picked.path,
        group: groupFilter === 'all' ? 'general' : groupFilter,
      });
      return;
    }

    if (!native?.pickOpenFiles) {
      void dialog.alert({ title: '파일 추가', body: '파일 선택을 사용할 수 없습니다.' });
      return;
    }

    const filters =
      type === 'app'
        ? [
            { name: '프로그램', extensions: ['exe', 'lnk', 'bat', 'cmd'] },
            { name: '모든 파일', extensions: ['*'] },
          ]
        : [{ name: '모든 파일', extensions: ['*'] }];

    const picked = await native.pickOpenFiles({
      title: type === 'app' ? '프로그램 선택' : '파일 선택',
      multi: false,
      filters,
      memoryKey: type === 'app' ? 'launcher.app' : 'launcher.file',
    });
    if (picked?.canceled || !picked?.paths?.[0]) return;
    const target = picked.paths[0];
    const base = String(target).replace(/[\\/]+$/, '').split(/[\\/]/).pop() || target;
    setDraft({
      ...blankDraft(type),
      title: base.replace(/\.(exe|lnk|bat|cmd)$/i, ''),
      target,
      group: groupFilter === 'all' ? 'general' : groupFilter,
    });
  };

  const saveDraft = async () => {
    if (!draft) return;
    const title = String(draft.title ?? '').trim();
    const target = String(draft.target ?? '').trim();
    if (!title) {
      void dialog.alert({ title: '입력 확인', body: '이름을 입력하세요.' });
      return;
    }
    if (!target) {
      void dialog.alert({ title: '입력 확인', body: '대상 경로 또는 주소를 입력하세요.' });
      return;
    }
    if (draft.type === 'url' && !/^https?:\/\//i.test(target)) {
      void dialog.alert({ title: '입력 확인', body: '웹사이트는 http:// 또는 https:// 로 시작해야 합니다.' });
      return;
    }

    setSaving(true);
    try {
      const payload = {
        id: draft.id || undefined,
        type: draft.type,
        title,
        target,
        icon: String(draft.icon || TYPE_ICON[draft.type]).slice(0, 32),
        group: draft.group === 'work' || draft.group === 'personal' ? draft.group : 'general',
        color: normalizeLauncherColorId(draft.color),
      };
      const res = await api('launcher.upsert', { item: payload });
      setItems(Array.isArray(res?.items) ? res.items : items);
      setDraft(null);
    } catch (err) {
      void dialog.alert({
        title: '저장 실패',
        body: err instanceof Error ? err.message : '저장하지 못했습니다.',
      });
    } finally {
      setSaving(false);
    }
  };

  const exportBackup = async () => {
    try {
      const res = await api('launcher.exportBackup');
      if (res?.cancelled) return;
      await showExportDone({
        dialog,
        native,
        summary: `${res?.count ?? 0}개 항목을 저장했습니다.`,
        filePath: res?.filePath,
      });
    } catch (err) {
      void dialog.alert({
        title: '내보내기 실패',
        body: err instanceof Error ? err.message : '내보내기에 실패했습니다.',
      });
    }
  };

  const importBackup = async () => {
    const choice = await dialog.choose({
      title: '런처 목록 가져오기',
      body: '파일을 어떻게 적용할까요?\n· 바꾸기: 현재 목록을 가져온 내용으로 교체\n· 합치기: 없는 항목만 추가',
      primaryLabel: '바꾸기',
      extraLabel: '합치기',
      cancelLabel: '취소',
    });
    if (!choice) return;
    const mode = choice === 'extra' ? 'merge' : 'replace';
    if (mode === 'replace' && items.length > 0) {
      const ok = await dialog.confirm({
        title: '목록 바꾸기',
        body: '현재 런처 목록이 가져온 내용으로 바뀝니다. 계속할까요?',
        confirmLabel: '바꾸기',
        confirmVariant: 'danger',
      });
      if (!ok) return;
    }
    try {
      const res = await api('launcher.importBackup', { mode });
      if (res?.cancelled) return;
      setItems(Array.isArray(res?.items) ? res.items : []);
      setDraft(null);
      void dialog.alert({
        title: '가져오기 완료',
        body: mode === 'merge' ? `합친 뒤 ${res?.count ?? 0}개 항목입니다.` : `${res?.count ?? 0}개 항목으로 바꿨습니다.`,
      });
    } catch (err) {
      void dialog.alert({
        title: '가져오기 실패',
        body: err instanceof Error ? err.message : '가져오지 못했습니다.',
      });
    }
  };

  return (
    <div
      className={`relative h-full overflow-auto px-6 py-6 ${
        fileDropOver ? 'bg-app-accentSoft/30' : ''
      }`}
      onDragEnter={(event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        setFileDropOver(true);
      }}
      onDragOver={(event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setFileDropOver(true);
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
        setFileDropOver(false);
      }}
      onDrop={(event) => {
        if (!isExternalFileDrag(event)) return;
        event.preventDefault();
        event.stopPropagation();
        void addDroppedFiles(event);
      }}
    >
      {fileDropOver ? (
        <div className="pointer-events-none absolute inset-3 z-20 flex items-center justify-center rounded-xl border-2 border-dashed border-app-accent bg-app-accentSoft/80 text-sm font-medium text-app-accentText">
          {addingDrops ? '추가하는 중…' : '놓으면 종류를 구분해 바로가기에 추가합니다'}
        </div>
      ) : null}
      <div className="space-y-5">
        <section className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="m-0 text-xl font-semibold text-slate-900">런처</h1>
            <p className="mt-1 text-sm text-slate-500">
              자주 쓰는 프로그램·웹사이트·폴더·파일을 바로 엽니다. 바탕화면 바로가기를 이 화면으로 끌어다 놓아도
              추가됩니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btnClass} onClick={() => void startAdd('app')}>
              + 프로그램
            </button>
            <button type="button" className={btnClass} onClick={() => void startAdd('url')}>
              + 웹사이트
            </button>
            <button type="button" className={btnClass} onClick={() => void startAdd('folder')}>
              + 폴더
            </button>
            <button type="button" className={btnClass} onClick={() => void startAdd('file')}>
              + 파일
            </button>
            <button type="button" className={btnClass} onClick={() => void exportBackup()}>
              내보내기
            </button>
            <button type="button" className={btnClass} onClick={() => void importBackup()}>
              가져오기
            </button>
            <button
              type="button"
              className={btnPrimaryClass}
              onClick={() => void openFloatingLauncher()}
            >
              플로팅 런처 실행
            </button>
          </div>
        </section>

        <section className="flex flex-wrap items-center gap-2">
          {/** @type {Array<'all' | LauncherItem['group']>} */ (['all', 'work', 'personal', 'general']).map((key) => {
            const selected = groupFilter === key;
            return (
              <button
                key={key}
                type="button"
                className={`rounded-full px-3 py-1 text-xs font-medium transition ${
                  selected
                    ? 'bg-app-accent text-white'
                    : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
                onClick={() => setGroupFilter(key)}
              >
                {GROUP_LABEL[key]} ({groupCounts[key] ?? 0})
              </button>
            );
          })}
          <label className="ml-auto min-w-[12rem] flex-1 sm:max-w-xs">
            <span className="sr-only">검색</span>
            <input
              type="search"
              className={inputClass}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="이름·경로·주소 검색"
            />
          </label>
        </section>

        {draft ? (
          <Section
            title={draft.id ? '바로가기 편집' : `${TYPE_LABEL[draft.type]} 추가`}
            description="아이콘·배경색·그룹·이름과 대상을 확인한 뒤 저장하세요."
          >
            <div className="grid gap-3 sm:grid-cols-[5rem_5rem_1fr_8rem]">
              <div className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">미리보기</span>
                <div
                  className="flex h-[2.625rem] items-center justify-center rounded-xl text-xl shadow-sm"
                  style={{ background: launcherColorGradient(draft.color) }}
                  aria-hidden
                >
                  {draft.icon || TYPE_ICON[draft.type]}
                </div>
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">아이콘</span>
                <input
                  className={`${inputClass} text-center text-lg`}
                  value={draft.icon ?? ''}
                  maxLength={8}
                  onChange={(event) => setDraft((current) => (current ? { ...current, icon: event.target.value } : current))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">이름</span>
                <input
                  className={inputClass}
                  value={draft.title ?? ''}
                  maxLength={120}
                  onChange={(event) => setDraft((current) => (current ? { ...current, title: event.target.value } : current))}
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-slate-600">그룹</span>
                <select
                  className={inputClass}
                  value={draft.group === 'work' || draft.group === 'personal' ? draft.group : 'general'}
                  onChange={(event) =>
                    setDraft((current) =>
                      current
                        ? { ...current, group: /** @type {LauncherItem['group']} */ (event.target.value) }
                        : current,
                    )
                  }
                >
                  <option value="general">공통</option>
                  <option value="work">업무</option>
                  <option value="personal">개인</option>
                </select>
              </label>
            </div>
            <div className="mt-3">
              <span className="text-xs font-medium text-slate-600">아이콘 배경</span>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                {LAUNCHER_COLOR_PALETTE.map((swatch) => {
                  const selected = normalizeLauncherColorId(draft.color) === swatch.id;
                  return (
                    <button
                      key={swatch.id}
                      type="button"
                      title={swatch.label}
                      aria-label={`배경색 ${swatch.label}`}
                      aria-pressed={selected}
                      className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 ${
                        selected ? 'border-slate-800' : 'border-white shadow ring-1 ring-slate-200'
                      }`}
                      style={{ background: `linear-gradient(145deg, ${swatch.from}, ${swatch.to})` }}
                      onClick={() =>
                        setDraft((current) => (current ? { ...current, color: swatch.id } : current))
                      }
                    />
                  );
                })}
              </div>
            </div>
            <div className="mt-2 max-h-[7.75rem] overflow-y-auto rounded-md border border-slate-200 bg-slate-50/80 p-2">
              <div className="grid grid-cols-[repeat(auto-fill,minmax(2rem,1fr))] gap-1.5">
                {ICON_PRESET_UNIQUE.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className={`flex h-8 w-full items-center justify-center rounded-md border text-base transition ${
                      draft.icon === emoji
                        ? 'border-app-accent bg-app-accentSoft'
                        : 'border-slate-200 bg-white hover:border-slate-300'
                    }`}
                    title="아이콘 선택"
                    onClick={() => setDraft((current) => (current ? { ...current, icon: emoji } : current))}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-xs font-medium text-slate-600">
                {draft.type === 'url' ? '주소' : '경로'}
              </span>
              <input
                className={`${inputClass} font-mono text-xs`}
                value={draft.target ?? ''}
                spellCheck={false}
                onChange={(event) => setDraft((current) => (current ? { ...current, target: event.target.value } : current))}
                placeholder={draft.type === 'url' ? 'https://example.com' : ''}
              />
            </label>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className={btnPrimaryClass} disabled={saving} onClick={() => void saveDraft()}>
                {saving ? '저장 중…' : '저장'}
              </button>
              <button type="button" className={btnClass} disabled={saving} onClick={() => setDraft(null)}>
                취소
              </button>
            </div>
          </Section>
        ) : null}

        {loading ? (
          <p className="text-sm text-slate-500">불러오는 중…</p>
        ) : items.length === 0 ? (
          <Section
            title="바로가기 없음"
            description="위 버튼으로 추가하거나, 바탕화면·탐색기의 바로가기·파일·폴더를 여기로 끌어다 놓으세요."
          >
            <p className="m-0 text-sm text-slate-500">추가한 항목은 이 PC의 데이터 폴더에 저장됩니다.</p>
          </Section>
        ) : filteredItems.length === 0 ? (
          <Section title="검색 결과 없음" description="그룹 필터나 검색어를 바꿔 보세요.">
            <button type="button" className={btnClass} onClick={() => { setQuery(''); setGroupFilter('all'); }}>
              필터 초기화
            </button>
          </Section>
        ) : (
          <section
            aria-label="바로가기 목록"
            className="grid grid-cols-[repeat(auto-fill,minmax(5.75rem,1fr))] gap-2"
          >
            {filteredItems.map((item) => {
              const isDragging = draggingId === item.id;
              const isOver = overId === item.id && draggingId && draggingId !== item.id;
              return (
                <div
                  key={item.id}
                  className={`group relative flex min-w-0 flex-col items-center rounded-xl border-2 bg-white p-2 pt-3 shadow-sm transition ${
                    isDragging
                      ? 'border-dashed border-slate-300 opacity-50'
                      : isOver
                        ? 'border-dashed border-app-accent ring-2 ring-app-accent/20'
                        : 'border-solid border-app-border hover:border-slate-300'
                  }`}
                  onDragOver={(event) => {
                    if (isExternalFileDrag(event)) {
                      event.preventDefault();
                      event.stopPropagation();
                      event.dataTransfer.dropEffect = 'copy';
                      setFileDropOver(true);
                      return;
                    }
                    if (!dragIdRef.current) return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    setOverId(item.id);
                  }}
                  onDragLeave={(event) => {
                    if (event.currentTarget.contains(/** @type {Node} */ (event.relatedTarget))) return;
                    setOverId((current) => (current === item.id ? null : current));
                  }}
                  onDrop={(event) => {
                    if (isExternalFileDrag(event)) {
                      event.preventDefault();
                      event.stopPropagation();
                      void addDroppedFiles(event);
                      return;
                    }
                    event.preventDefault();
                    const fromId = dragIdRef.current || event.dataTransfer.getData('text/launcher-id');
                    moveBefore(fromId, item.id);
                    dragIdRef.current = null;
                    setDraggingId(null);
                    setOverId(null);
                  }}
                >
                  <div className="absolute right-0.5 top-0.5 z-10 flex gap-0.5 opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded bg-white/95 text-[11px] text-slate-500 shadow-sm ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800"
                      title="편집"
                      aria-label={`${item.title} 편집`}
                      onClick={() => setDraft({ ...item })}
                    >
                      ✎
                    </button>
                    <button
                      type="button"
                      className="flex h-5 w-5 items-center justify-center rounded bg-white/95 text-[12px] font-semibold text-red-500 shadow-sm ring-1 ring-slate-200 hover:bg-red-50"
                      title="삭제"
                      aria-label={`${item.title} 삭제`}
                      onClick={() => void removeItem(item)}
                    >
                      ×
                    </button>
                  </div>
                  <button
                    type="button"
                    draggable
                    className="flex w-full cursor-grab flex-col items-center gap-1.5 active:cursor-grabbing"
                    aria-label={`${item.title} 열기`}
                    title={item.target}
                    disabled={busyId === item.id}
                    onDragStart={(event) => {
                      didDragRef.current = true;
                      dragIdRef.current = item.id;
                      setDraggingId(item.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/launcher-id', item.id);
                      event.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragEnd={() => {
                      dragIdRef.current = null;
                      setDraggingId(null);
                      setOverId(null);
                      window.setTimeout(() => {
                        didDragRef.current = false;
                      }, 0);
                    }}
                    onClick={() => {
                      if (didDragRef.current) return;
                      void openItem(item);
                    }}
                  >
                    <span
                      className="flex h-12 w-12 items-center justify-center rounded-2xl text-2xl shadow-sm"
                      style={{ background: launcherColorGradient(item.color) }}
                    >
                      {item.icon || TYPE_ICON[item.type]}
                    </span>
                    <span className="w-full truncate text-center text-[11px] font-medium leading-tight text-slate-800">
                      {item.title}
                    </span>
                  </button>
                </div>
              );
            })}
          </section>
        )}
      </div>
    </div>
  );
}
