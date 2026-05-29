// ============================================================
// korean-utils.js — 한국어 음절 처리 유틸리티
// ============================================================

const HANGUL_START  = 0xAC00;
const JUNG_COUNT    = 21;
const JONG_COUNT    = 28;
const CHO = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

/** 한글 음절 → 초성/중성/종성 인덱스 */
function decompose(char) {
  const code = char.charCodeAt(0) - HANGUL_START;
  if (code < 0 || code > 11171) return null;
  return {
    cho:  Math.floor(code / (JUNG_COUNT * JONG_COUNT)),
    jung: Math.floor((code % (JUNG_COUNT * JONG_COUNT)) / JONG_COUNT),
    jong: code % JONG_COUNT
  };
}

/** 문자열에서 한글 음절 수 */
function countSyllables(str) {
  return (str.match(/[가-힣]/g) || []).length;
}

/** 문자열의 마지막 한글 음절 */
function lastKoreanChar(str) {
  const m = str.match(/[가-힣]/g);
  return m ? m[m.length - 1] : null;
}

/** 문자열의 첫 번째 한글 음절 */
function firstKoreanChar(str) {
  const m = str.match(/[가-힣]/);
  return m ? m[0] : null;
}

/**
 * 끝말잇기 연결 유효성 검사 (두음법칙 포함)
 * prevChar: 이전 단어 마지막 글자 / nextChar: 다음 단어 첫 글자
 */
function isValidChain(prevChar, nextChar) {
  if (!prevChar || !nextChar) return false;
  if (prevChar === nextChar) return true;

  const p = decompose(prevChar);
  const n = decompose(nextChar);
  if (!p || !n) return false;
  if (p.jung !== n.jung || p.jong !== n.jong) return false;

  const pCho = CHO[p.cho];
  const nCho = CHO[n.cho];

  // 두음법칙 1: ㄹ ↔ ㄴ
  if ((pCho==='ㄹ'&&nCho==='ㄴ') || (pCho==='ㄴ'&&nCho==='ㄹ')) return true;

  // 두음법칙 2: ㄴ ↔ ㅇ (ㅣ·ㅑ·ㅕ·ㅛ·ㅠ·ㅒ·ㅖ·ㅢ 앞)
  // JUNG 인덱스: ㅑ=2,ㅒ=3,ㅕ=6,ㅖ=7,ㅛ=12,ㅠ=17,ㅢ=19,ㅣ=20
  if ([2,3,6,7,12,17,19,20].includes(p.jung)) {
    if ((pCho==='ㄴ'&&nCho==='ㅇ') || (pCho==='ㅇ'&&nCho==='ㄴ')) return true;
  }

  return false;
}

/**
 * 단어 유효성 종합 검사
 * @returns {{ valid: boolean, error?: string }}
 */
function validateWord(word, mode, previousWord, usedWords = []) {
  word = word.trim();
  if (!word) return { valid: false, error: '단어를 입력해주세요.' };

  const syl = countSyllables(word);
  if (syl === 0) return { valid: false, error: '한글 단어를 입력해주세요.' };
  if (syl !== mode) return { valid: false, error: `${mode}글자 단어를 입력해주세요. (현재 ${syl}자)` };

  if (previousWord) {
    const prevLast  = lastKoreanChar(previousWord);
    const nextFirst = firstKoreanChar(word);
    if (!isValidChain(prevLast, nextFirst))
      return { valid: false, error: `'${prevLast}'(으)로 시작하는 단어를 입력해주세요.` };
  }

  if (usedWords.includes(word))
    return { valid: false, error: '이미 이 게임에서 사용된 단어입니다.' };

  return { valid: true };
}
