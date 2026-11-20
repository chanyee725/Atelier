// Strong masking for saved chat history (.atelier/chat/, #968). The chat is the one place a
// conversation is kept on disk, so this goes further than redact.js: on top of its key and email
// shapes it hides phone-like numbers, long random tokens, absolute and home paths and name-like
// words in common contexts. It matches shapes, not known values, and leans to masking too much:
// a false positive only hides a word in an old conversation.
import { MASK, redact } from "./redact.js";

export { MASK };
export const IMAGE = "[이미지]";

// Path characters: anything up to whitespace, quotes, brackets, separators and a `:line` suffix.
const P = "[^\\s'\"`<>()\\[\\]{},;:|]";
// Common nouns that take 님/씨 in this app's copy and are not names.
const NOT_NAMES = new Set(["사용자", "관리자", "고객", "회원", "선생", "리뷰어", "구현자", "팀원", "여러분", "작성자", "담당자", "개발자", "디자이너", "테스터", "팀장", "대표", "손님"]);

/** `word` as a pattern that matches it in any case, while the name after it must still be capitalized. */
function anyCase(word) {
  return word.replace(/[a-z]/g, c => `[${c}${c.toUpperCase()}]`).replace(/ /g, "\\s+");
}

/** [pattern, replacer]: a replacer string, or a function of the match. Order matters (see chatRedact). */
const RULES = [
  // Inline images (data URLs) are never kept, only a placeholder.
  [/data:image\/[\w.+-]+;base64,[A-Za-z0-9+/=]+/g, IMAGE],
  // PEM blocks (private keys, certificates).
  [/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?(?:-----END [A-Z0-9 ]+-----|$)/g, MASK],
  // user:password@ in URLs.
  [/(\b[a-z][\w+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, (_m, scheme) => `${scheme}${MASK}@`],
  // SSH remotes carry the account name (git@host:owner/repo); redact.js leaves them, this does not.
  [/\b[\w.-]+@[\w.-]+:[\w./~-]+/g, MASK],
  // Secret assignments with more key names than redact.js knows.
  [/\b((?:client[_-]?secret|private[_-]?key|credentials?|cookie|session[_-]?(?:id|key|token)|refresh[_-]?token|id[_-]?token|apikey|pwd|pass)["']?\s*[:=]\s*["']?)[^\s"',;]{4,}/gi, (_m, keep) => `${keep}${MASK}`],
  // Windows (C:\Users\...) and UNC (\\server\share) paths.
  [/\b[A-Za-z]:\\[^\s'"`<>|]*/g, MASK],
  [/\\\\[^\s\\'"`<>|]+\\[^\s'"`<>|]*/g, MASK],
  // Home paths: ~/x, ~user/x, $HOME/x, %USERPROFILE%\x.
  [new RegExp(`(?<![\\w/])~[\\w.-]*\\/${P}*`, "g"), MASK],
  [new RegExp(`\\$\\{?HOME\\}?(?:\\/${P}*)?`, "g"), MASK],
  [/%(?:USERPROFILE|HOMEPATH|APPDATA|LOCALAPPDATA)%[^\s'"`<>|]*/gi, MASK],
  // file:// URLs and absolute paths under a system root (masked whole, even a bare /home).
  [new RegExp(`\\bfile:\\/\\/${P}*`, "gi"), MASK],
  [new RegExp(`(?<![\\w.:/~\\\\-])\\/(?:home|Users|root|tmp|var|etc|opt|mnt|media|private|srv|usr|Volumes|workspaces?|data|run|nix|snap|proc|dev|lib|bin|sbin|Library|Applications|System)(?![\\w.-])(?:\\/${P}*)?`, "g"), MASK],
  // Any other absolute path with three or more parts (/a/b/c). URLs are left alone: their slashes follow ':' or '/'.
  [new RegExp(`(?<![\\w.:/~\\\\-])(?:\\/${P}+){3,}\\/?`, "g"), MASK],
  // UUIDs, long hex (hashes, ids) and long letter+digit runs (tokens without a known prefix).
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, MASK],
  [/(?<![\w-])[A-Za-z0-9_+=-]{20,}(?![\w-])/g, m => (looksRandom(m) ? MASK : m)],
  // Phone, card, resident-registration and other long numbers (9 to 19 digits with separators). Dates are kept.
  [/(?<![\w.])\+?\(?\d[\d().\- ]{6,}\d(?![\w])/g, m => maskNumber(m)],
  // Korean names before a title: 홍길동님, 김 대리, 박철수 씨.
  [/(?<![가-힣])([가-힣]{2,4})(\s?)(님|씨|선배|선생님|교수님?|팀장님?|대리님?|과장님?|차장님?|부장님?|실장님?|이사님?|대표님|매니저님?|사원님?|주임님?)(?![가-힣])/g,
    (m, name, sp, title) => (NOT_NAMES.has(name) ? m : `${MASK}${sp}${title}`)],
  // A name after a self-introduction or a name field: 제 이름은 X, 저는 X입니다, name: X, Author: X.
  [/((?:제\s*이름은|이름은|이름\s*[:=]|성함은|성함\s*[:=])\s*)([가-힣]{2,4}|[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*){0,2})/g, (_m, keep) => `${keep}${MASK}`],
  [/((?:저는|나는)\s*)([가-힣]{2,4})(?=이에요|예요|입니다|이고|이야|라고)/g, (_m, keep) => `${keep}${MASK}`],
  [new RegExp(`(\\b(?:${["my name is", "i am", "i'm", "this is", "name", "full name", "username", "user", "author", "co-authored-by:", "signed-off-by:", "reviewed-by:", "reported-by:", "dear", "hi", "hello", "hey", "thanks", "thank you", "cc"].map(anyCase).join("|")})\\s*[:=]?\\s+)[A-Z][\\w'-]*(?:\\s+[A-Z][\\w'-]*){0,2}`, "g"),
    (_m, keep) => `${keep}${MASK}`],
  [/\b(Mr|Mrs|Ms|Miss|Dr|Prof|Sir|Madam)\.?\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?/g, MASK],
  // @handles (GitHub logins, chat mentions); scoped packages (@types/node) are kept.
  [/(?<![\w.@])@[A-Za-z0-9][A-Za-z0-9_-]{0,38}(?![\w/@.-])/g, MASK],
];

/** A token-like run: letters and digits mixed in one long part, or very long overall. Word-ish branch and file names pass. */
function looksRandom(s) {
  const mixed = t => /[A-Za-z]/.test(t) && /\d/.test(t);
  if (/^[0-9a-f]{32,}$/i.test(s)) return true;
  if (s.length >= 40 && mixed(s)) return true;
  return s.split(/[-_]/).some(part => part.length >= 16 && mixed(part));
}

/** Masks 9 to 19 digits that read like a phone, card or id number; dates and times stay. */
function maskNumber(m) {
  const digits = m.replace(/\D/g, "").length;
  if (digits < 9 || digits > 19) return m;
  if (/^\d{4}[-./]\d{1,2}[-./]\d{1,2}(?:\s+\d{1,2})?$/.test(m.trim())) return m;
  return MASK;
}

/** `text` with every sensitive-looking part replaced by MASK (images by IMAGE); anything not a string is returned as is. */
export function chatRedact(text) {
  if (typeof text !== "string" || !text) return text;
  // Shape rules that need the raw text (images, PEM, URL credentials, SSH remotes) run before redact.js.
  let out = text;
  for (const [re, rep] of RULES.slice(0, 4)) out = out.replace(re, rep);
  out = redact(out);
  for (const [re, rep] of RULES.slice(4)) out = out.replace(re, rep);
  return out;
}

/** A copy of `value` with every string inside it (objects, arrays) masked; keys are kept. */
export function chatRedactDeep(value) {
  if (typeof value === "string") return chatRedact(value);
  if (Array.isArray(value)) return value.map(chatRedactDeep);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, chatRedactDeep(v)]));
  return value;
}
