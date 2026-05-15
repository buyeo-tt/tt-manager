import React, { useState, useMemo, useEffect, useRef, useCallback, useContext, createContext } from 'react';
import { 
  StyleSheet, Text, View, TextInput, TouchableOpacity, 
  Alert, ScrollView, Share, Platform, KeyboardAvoidingView, Modal, FlatList, Keyboard 
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as MediaLibrary from 'expo-media-library';
import { captureRef } from 'react-native-view-shot';

// ==========================================
// 🚀 상수 및 유틸리티
// ==========================================
const DEFAULT_CLUB_KEY = '__DEFAULT_CLUB__'; 

function shuffleArray(array) {
  const arr = [...array];
  let currentIndex = arr.length, randomIndex;
  while (currentIndex > 0) {
    randomIndex = Math.floor(Math.random() * currentIndex);
    currentIndex--;
    [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
  }
  return arr;
}

const getMatchKey = (p1, p2) => (!p1 || !p2) ? '' : (p1 < p2 ? `${p1}||${p2}` : `${p2}||${p1}`);
const toPlayerObj = (p) => (typeof p === 'string' ? { name: p, club: DEFAULT_CLUB_KEY } : p);
const getPlayerName = (p) => (typeof p === 'object' && p !== null ? p.name : p);
const normalizeName = (item) => getPlayerName(item).replace(/\s+/g, ' ').trim().toLowerCase();
const extractNumber = (item) => {
  const match = getPlayerName(item).match(/(\d+)[^\d]*$/);
  return match ? parseInt(match[1], 10) : Infinity; 
};

const sortPlayers = (list) => {
  return [...list].map(toPlayerObj).sort((a, b) => {
    const numA = extractNumber(a.name);
    const numB = extractNumber(b.name);
    if (numA !== numB) return numA - numB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
};

const getDisplayClubName = (clubKey, t) => clubKey === DEFAULT_CLUB_KEY ? t('defaultClub') : clubKey;

const getColorForPlayer = (name, isColorMode) => {
  if (!isColorMode) return '#333';
  const colors = ['#e6194b', '#3cb44b', '#f58231', '#911eb4', '#f032e6', '#008080', '#9a6324', '#800000', '#808000', '#000075', '#4363d8', '#e6beff'];
  let hash = 0; 
  for(let i=0; i<name.length; i++) hash += name.charCodeAt(i);
  return colors[hash % colors.length];
}

function calculateStandingsData(players, matches, rankingSystem, matchMap, manualTieBreakers = {}) {
  let stats = players.reduce((acc, name) => { acc[name] = { name, win: 0, lose: 0, scoreSum: 0 }; return acc; }, {});
  matches.forEach(m => {
    if (m.completed) { 
      const score1 = parseInt(m.s1, 10) || 0, score2 = parseInt(m.s2, 10) || 0;
      stats[m.p1].scoreSum += score1; stats[m.p2].scoreSum += score2;
      if (score1 > score2) { stats[m.p1].win += 1; stats[m.p2].lose += 1; } 
      else if (score1 < score2) { stats[m.p2].win += 1; stats[m.p1].lose += 1; }
    }
  });
  
  const sortedStats = Object.values(stats).sort((a, b) => {
    let cmp = 0;
    if (rankingSystem === 'points') { if (b.scoreSum !== a.scoreSum) cmp = b.scoreSum - a.scoreSum; else if (b.win !== a.win) cmp = b.win - a.win; } 
    else { if (b.win !== a.win) cmp = b.win - a.win; else if (b.scoreSum !== a.scoreSum) cmp = b.scoreSum - a.scoreSum; }
    if (cmp === 0) { const h2h = matchMap[getMatchKey(a.name, b.name)]; if (h2h && h2h.completed) { const aScore = h2h.p1 === a.name ? (parseInt(h2h.s1)||0) : (parseInt(h2h.s2)||0); const bScore = h2h.p1 === b.name ? (parseInt(h2h.s1)||0) : (parseInt(h2h.s2)||0); cmp = bScore - aScore; } }
    if (cmp === 0) cmp = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    return cmp;
  });
  
  sortedStats.forEach((s, i) => {
    if (i === 0) { s.rank = 1; } 
    else {
      const prev = sortedStats[i - 1]; let cmp = 0;
      if (rankingSystem === 'points') { if (prev.scoreSum !== s.scoreSum) cmp = prev.scoreSum - s.scoreSum; else if (prev.win !== s.win) cmp = prev.win - s.win; } 
      else { if (prev.win !== s.win) cmp = prev.win - s.win; else if (prev.scoreSum !== s.scoreSum) cmp = prev.scoreSum - s.scoreSum; }
      if (cmp === 0) { const h2h = matchMap[getMatchKey(prev.name, s.name)]; if (h2h && h2h.completed) { const prevScore = h2h.p1 === prev.name ? (parseInt(h2h.s1)||0) : (parseInt(h2h.s2)||0); const sScore = h2h.p1 === s.name ? (parseInt(h2h.s1)||0) : (parseInt(h2h.s2)||0); cmp = prevScore - sScore; } }
      if (cmp === 0) { s.rank = prev.rank; } else { s.rank = i + 1; }
    }
  });

  const internalSorted = [...sortedStats].sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    const tbA = manualTieBreakers[a.name] || 999;
    const tbB = manualTieBreakers[b.name] || 999;
    if (tbA !== tbB) return tbA - tbB;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });

  internalSorted.forEach((s, i) => { s.internalRank = i + 1; });
  return internalSorted;
}

// ==========================================
// 🌐 1. 다국어(i18n) 사전 및 Context 설정
// ==========================================
const translations = {
  ko: {
    appName: "탁구 대진표 매니저",
    playerDbBtn: "👥 선수 관리 DB",
    leagueBtn: "🔄 리그전 (예선 조편성)",
    tournamentBtn: "🏆 토너먼트 (본선)",
    manualBtn: "📖 앱 사용 설명서",
    continueTournament: "진행중인 토너먼트 계속하기", 
    playerManagerTitle: "선수 관리 DB",
    manualTitle: "앱 사용 설명서",
    backToMain: "◀ 메인",
    export: "내보내기",
    exportSelectTitle: "내보낼 명단 선택",
    exportAllPlayers: "전체 명단",
    addClubBtn: "+ 동호회",
    newClubTitle: "새 동호회 추가",
    clubNamePlaceholder: "동호회 이름",
    all: "전체",
    addingToClubHint: "📌 [{club}]에 추가중",
    nameInputPlaceholder: "이름+부수 (예:홍길동 6)",
    defaultClub: "기본 동호회",
    add: "등록",
    pasteListBtn: "📥 텍스트 붙여넣기",
    pasteListTitle: "명단 텍스트 붙여넣기",
    pastePlaceholder: "[A동호회] 홍길동 6\n이순신 5",
    cancel: "취소",
    import: "가져오기",
    notice: "알림",
    error: "오류",
    warning: "경고",
    matchWarningTitle: "경고", 
    matchWarningDesc: "진행 중인 경기 데이터가 있습니다. 새로운 대진표를 생성하면 기존 기록이 모두 삭제됩니다. 계속하시겠습니까?", 
    apply: "확인", 
    enterName: "이름을 입력해주세요.",
    alreadyRegistered: "이미 등록된 선수입니다.",
    noPlayerExport: "내보낼 선수가 없습니다.",
    noPlayerImport: "가져올 유효한 이름이 없습니다.",
    importConfirm: "{count}명의 선수를 추가하시겠습니까?",
    back: "◀ 뒤로",
    tournamentSetupTitle: "[{groupName}] 시드 세팅",
    basicInfo: "1. 토너먼트 기본 정보",
    totalPlayers: "총 참가자 수:",
    prelimGroups: "가이드라인 조 개수:",
    autoByeInfo: "💡 {size}강 대진표, 빈자리에 {byes}개 부전승 자동 배치",
    seedAssignment: "2. 참가 선수 시드 배정",
    seedSlot: "시드 {num}번 슬롯",
    groupRank: "{group}조 {rank}위",
    genBracketBtn: "대진표 생성 완료",
    minPlayersReq: "최소 2명 이상 필요합니다.",
    maxPlayersReq: "토너먼트는 최대 256명까지만 생성할 수 있습니다.",
    leagueMaxError: "기기 성능을 위해 한 조당 최대 20명까지만 생성할 수 있습니다.",
    bye: "부전승",
    waiting: "대기중",
    unselected: "미선택",
    exit: "◀ 메인", 
    bracketBoard: "[{groupName}] 대진표",
    refereeNotice: "📢 심판 안내: [{name}]님은 다음 경기 심판입니다.",
    tournamentBracket: "🏆 {groupName} ({size}강)",
    finals: "결승전",
    roundOf: "{size}강",
    shareResults: "📢 결과 공유",
    saveFullImage: "📸 전체 구조도 저장",
    selectWinner: "승자 선택",
    wait: "대기",
    notFinished: "결승전 결과가 아직 결정되지 않았습니다.",
    none: "없음",
    tourneyResultText: "🏆 [{groupName} 탁구 대회 결과] 🏆\n\n🥇 우승: {winner}\n🥈 준우승: {runnerUp}\n🥉 공동 3위: {thirds}",
    needPermission: "권한 필요",
    permissionDesc: "사진 앱 접근 권한이 필요합니다.",
    saveSuccess: "저장 완료",
    saveImageSuccess: "사진첩에 안전하게 저장되었습니다! 📸",
    saveFailed: "저장에 실패했습니다.",
    prelimSetup: "예선 명단 및 조 편성",
    loadFromDb: "1. 선수 관리 DB에서 불러오기",
    swipeInstruction: "가로로 스와이프하여 참가시킬 선수를 터치하세요.",
    noAvailablePlayers: "선택 가능한 선수가 없습니다.",
    confirmedPlayers: "2. [{groupName}] 참가 확정 선수 ({count}명)",
    tapToRemove: "터치하면 제외됩니다.",
    noSelectedPlayers: "선택된 선수가 없습니다.",
    genMatchesBtn: "대진 생성 (보드로 이동)",
    enterBoardBtn: "▶ {groupName} 보드 입장",
    resetBoardBtn: "대진표 초기화",
    createMatchesBtn: "새로 만들기",
    backToSetup: "◀ 명단설정",
    prelimBoard: "[{groupName}] 예선 매치보드",
    leagueBoardTitle: "🏆 {groupName} 매치보드 & 결과",
    player: "선수",
    detailedStandings: "📊 상세 순위표",
    rank: "순위",
    name: "이름",
    winLoss: "승/패",
    totalPoints: "총득점",
    winLossFormat: "{win}승 {lose}패",
    scoreBoard: "📅 점수 기록 보드",
    matchNumber: "{num}경기 (심판:{ref})",
    share: "결과 공유",
    saveImage: "이미지 저장",
    saveProgress: "진행 저장",
    saveProgressMsg: "현재 경기 진행 상황이 저장되었습니다.",
    reset: "초기화",
    leagueResultText: "[탁구 {groupName} 최종 순위]\n\n{text}",
    leagueRankLine: "{rank}위: {name} ({win}승 {lose}패, 득점: {pts})",
    resetAlertTitle: "초기화",
    resetAlertDesc: "진행 중인 모든 경기 결과를 지우시겠습니까?",
    langSwitch: "English",
    rankingMethodTitle: "순위 결정 방식",
    rankPoints: "승점제",
    rankWins: "승패제",
    selectSaveOption: "저장 옵션 선택",
    saveGrid: "📊 매치보드(그리드) 저장",
    saveStandings: "🏆 상세 순위표 저장",
    saveScoreBoard: "📅 점수 기록 보드 저장",
    savePrintableScorecards: "🖨️ 1:1 대진표 저장 (기록지)",
    clubCreateHint: "동호회가 생성되었습니다.",
    matchOrder: "경기 순서",
    sortDefault: "기본순",
    sortName: "이름순",
    sortClass: "부수순",
    colorMode: "🎨 컬러",
    addGroup: "+ 조 추가",
    delGroup: "조 삭제",
    groupNameInputTitle: "조 이름 입력",
    groupNamePlaceholder: "예: 1조, 상위부 등",
    summaryTitle: "📊 전체 조 결과 요약",
    summaryBtn: "📊 전체 요약",
    noDataGroup: "결과 데이터가 없습니다.",
    savedGroupsInfo: "💾 명단 템플릿 (자주 쓰는 그룹)",
    saveCurrentList: "+ 현재 명단 템플릿 저장",
    noSavedGroups: "저장된 명단 템플릿이 없습니다.",
    template: "템플릿 {index}",
    delete: "삭제",
    load: "불러오기",
    saveListEmpty: "저장할 선수가 없습니다.",
    saveListMax: "템플릿은 최대 10개까지 저장할 수 있습니다.",
    saveListSuccess: "명단이 템플릿으로 저장되었습니다.",
    loadGroupSuccess: "템플릿 명단이 현재 조에 덮어씌워졌습니다.",
    
    goToActiveGame: "▶ 진행중인 게임 입장",
    importLeague: "🔄 리그 결과 연동",
    manualSelect: "✍️ 직접 선택",
    rankRange: "진출 순위:",
    toRank: "위 까지",
    importBtn: "명단 가져오기",
    importSuccess: "{count}명의 선수를 리그에서 불러왔습니다.",
    noImportData: "조건에 맞는 선수가 없습니다. 리그전 결과를 확인해주세요.",
    importedCount: "📌 리그에서 불러온 선수: {count}명",
    integrated: "통합진행",
    upperBracket: "상위부",
    lowerBracket: "하위부",
    
    matchScorecardTitle: "{groupName} - 매치 기록지",
    matchRefAndTable: "심판: {ref} / 테이블: ________",
    finalScore: "최종 점수",
    finalWinner: "최종 승자: _________________",
    gameNum: "{num} 게임",

    manualSec1Title: "👥 선수 관리 DB (Player Manager)",
    manualS1B1Title: "동호회 분류 및 스마트 정렬:",
    manualS1B1Desc: "선수 등록 시 소속 동호회를 함께 입력하면 쉽게 필터링 할 수 있습니다. 이름 뒤에는 부수(숫자)를 적어주세요. 자동 오름차순 정렬됩니다.",
    manualS1B4Title: "대량 등록:",
    manualS1B4Desc: "카톡 명단을 복사해 [텍스트 붙여넣기]를 사용하면 한 번에 수십 명을 쉽게 등록할 수 정렬됩니다.",
    manualSec2Title: "🔄 리그전 (멀티 조 편성)",
    manualS2B0Title: "다중 조(Group) 관리 탭 기능:",
    manualS2B0Desc: "예선 명단 설정 상단의 탭(1조, 2조...)을 통해 여러 조를 동시에 편성할 수 있습니다. (💡특정 조에 편성된 선수는 다른 조에 중복 편성되지 않도록 자동 필터링됩니다.)",
    manualS2B1Title: "순위 결정 로직 (승점/승패):",
    manualS2B1Desc: "총득점우선(승점제) 또는 다승우선(승패제)을 선택할 수 있으며, 동점일 경우 맞대결 승자를 앱이 판단합니다.",
    manualS2B2Title: "최장 휴식 및 공평 심판 배정:",
    manualS2B2Desc: "연속 경기를 최소화하지만, 인원에 따라 불가피하게 연속 경기가 배정될 수 있습니다. 심판을 가장 적게 본 사람을 자동으로 배정합니다.",
    manualS2B3Title: "안전한 이미지 저장 (공통):",
    manualS2B3Desc: "화면 하단의 이미지 저장 버튼을 누르면 팝업 모달이 뜹니다. 안드로이드/iOS 관계없이 대진표, 순위표, 개별 기록지를 앨범에 안전하게 저장할 수 있습니다.",
    manualSec3Title: "🏆 토너먼트 (Tournament)",
    manualS3B1Title: "스네이크 시드 및 부전승(BYE):",
    manualS3B1Desc: "참가 인원에 맞춰 자동 8~256강 구조도를 생성하며 부전승을 계산합니다. 상위권 선수는 결승 이전까지 서로 만나지 않게 찢어놓습니다.",
    manualS3B2Title: "리그전 결과 연동 (상·하위부 편성):",
    manualS3B2Desc: "예선(리그전)의 순위 결과를 바탕으로 본선 진출자를 자동 연동할 수 있습니다. 순위별로 상위부와 하위부를 나누어 편성할 때 유용합니다.",
    manualS3B3Title: "1:1 매치 기록지 및 전체 대진표 저장:",
    manualS3B3Desc: "진행 중인 매치 카드를 눌러 '기록지 출력'을 선택하면 개별 경기 기록지를 저장할 수 있으며, 하단의 '전체 구조도 저장'을 통해 진행 현황을 사진으로 남길 수 있습니다.",
    manualS3B4Title: "승자 번복 시스템:",
    manualS3B4Desc: "매치 카드를 터치해 '승자'를 고르면 해당 선수가 다음 라운드로 진출합니다. 잘못 선택했을 경우 언제든 다시 카드를 눌러 승자를 번복할 수 있습니다."
  },
  en: { 
    appName: "TT Bracket Manager", playerDbBtn: "👥 Player DB", leagueBtn: "🔄 League (Groups)", tournamentBtn: "🏆 Tournament", manualBtn: "📖 App Manual", continueTournament: "Continue Tournament", playerManagerTitle: "Player DB", manualTitle: "User Manual", backToMain: "◀ Home", export: "Export", exportSelectTitle: "Select List to Export", exportAllPlayers: "All Players", addClubBtn: "+ Club", newClubTitle: "Add New Club", clubNamePlaceholder: "Club Name", all: "All", addingToClubHint: "📌 Adding to [{club}]", nameInputPlaceholder: "Name + Class", defaultClub: "Default Club", add: "Add", pasteListBtn: "📥 Paste Text", pasteListTitle: "Paste Player List", pastePlaceholder: "[Club A] John 6\nJane 5", cancel: "Cancel", import: "Import", notice: "Notice", error: "Error", warning: "Warning", matchWarningTitle: "Warning", matchWarningDesc: "There are ongoing matches. Creating new matches will delete existing results. Continue?", apply: "Confirm", enterName: "Enter a name.", alreadyRegistered: "Player already registered.", noPlayerExport: "No players to export.", noPlayerImport: "No valid names.", importConfirm: "Add {count} players?", back: "◀ Back", tournamentSetupTitle: "[{groupName}] Setup", basicInfo: "1. Basic Info", totalPlayers: "Total Players:", prelimGroups: "Guide Groups:", autoByeInfo: "💡 Round of {size}, {byes} Byes will be assigned", seedAssignment: "2. Seed Assignment", seedSlot: "Seed {num} Slot", groupRank: "Gr {group} - Rank {rank}", genBracketBtn: "Generate Bracket", minPlayersReq: "At least 2 players needed.", maxPlayersReq: "Max 256 players allowed.", leagueMaxError: "Max 20 players per group.", bye: "Bye", waiting: "Waiting", unselected: "Unselected", exit: "◀ Home",  bracketBoard: "[{groupName}] Board", refereeNotice: "📢 Referee: [{name}] is the referee.", tournamentBracket: "🏆 {groupName} (Round of {size})", finals: "Finals", roundOf: "Round of {size}", shareResults: "📢 Share Results", saveFullImage: "📸 Save Full Image", selectWinner: "Select Winner", wait: "Wait", notFinished: "Finals not determined.", none: "None", tourneyResultText: "🏆 [{groupName} Tournament Results] 🏆\n\n🥇 1st: {winner}\n🥈 2nd: {runnerUp}\n🥉 3rd: {thirds}", needPermission: "Permission Required", permissionDesc: "Photo library access is needed.", saveSuccess: "Saved", saveImageSuccess: "Saved to gallery! 📸", saveFailed: "Failed to save.", prelimSetup: "Prelims Setup", loadFromDb: "1. Load from DB", swipeInstruction: "Swipe horizontally and tap to add.", noAvailablePlayers: "No available players.", confirmedPlayers: "2. [{groupName}] Confirmed ({count})", tapToRemove: "Tap to remove.", noSelectedPlayers: "No selected players.", genMatchesBtn: "Generate Matches", enterBoardBtn: "▶ Enter {groupName} Board", resetBoardBtn: "Reset Bracket", createMatchesBtn: "Create New", backToSetup: "◀ Setup", prelimBoard: "[{groupName}] Match Board", leagueBoardTitle: "🏆 {groupName} Match Board", player: "Player", detailedStandings: "📊 Standings", rank: "Rank", name: "Name", winLoss: "W/L", totalPoints: "Pts", winLossFormat: "{win}W {lose}L", scoreBoard: "📅 Score Board", matchNumber: "Match {num} (Ref:{ref})", share: "Share", saveImage: "Save Image", saveProgress: "Save Progress", saveProgressMsg: "Match progress has been saved.", reset: "Reset", leagueResultText: "[{groupName} Standings]\n\n{text}", leagueRankLine: "{rank}: {name} ({win}W {lose}L, Pts: {pts})", resetAlertTitle: "Reset", resetAlertDesc: "Clear all match results?", langSwitch: "한국어", rankingMethodTitle: "Ranking System", rankPoints: "Points", rankWins: "Win/Loss", selectSaveOption: "Select Save Option", saveGrid: "📊 Save Grid", saveStandings: "🏆 Save Standings", saveScoreBoard: "📅 Save Score Board", savePrintableScorecards: "🖨️ Save All Match Scorecards", clubCreateHint: "Club created.", matchOrder: "Match Order", sortDefault: "Default", sortName: "Name", sortClass: "Class", colorMode: "🎨 Color", addGroup: "+ Add Group", delGroup: "Delete Group", groupNameInputTitle: "Group Name", groupNamePlaceholder: "e.g. Group A", summaryTitle: "📊 All Groups Summary", summaryBtn: "📊 Summary", noDataGroup: "No match data.", savedGroupsInfo: "💾 Saved Templates", saveCurrentList: "+ Save Current Template", noSavedGroups: "No templates saved.", template: "Template {index}", delete: "Del", load: "Load", saveListEmpty: "No players to save.", saveListMax: "Max 10 templates allowed.", saveListSuccess: "Template saved.", loadGroupSuccess: "Template loaded to current group.", goToActiveGame: "▶ Active Game", importLeague: "🔄 Import League", manualSelect: "✍️ Manual Select", rankRange: "Rank Range:", toRank: "", importBtn: "Import Players", importSuccess: "Imported {count} players from League.", noImportData: "No players matched the criteria.", importedCount: "📌 Imported from League: {count} players", integrated: "Integrated", upperBracket: "Upper", lowerBracket: "Lower", matchScorecardTitle: "{groupName} - Match Scorecard", matchRefAndTable: "Ref: {ref} / Table: ________", finalScore: "Final Score", finalWinner: "Final Winner: _________________", gameNum: "Game {num}",
    manualSec1Title: "👥 Player Database", manualS1B1Title: "Club & Sorting:", manualS1B1Desc: "Filter easily by club. Add class number for auto-sorting.", manualS1B4Title: "Bulk Add:", manualS1B4Desc: "Paste text lists to add multiple players.", manualSec2Title: "🔄 League (Groups)", manualS2B0Title: "Multi-Group Tabs:", manualS2B0Desc: "Manage multiple groups simultaneously via top tabs.", manualS2B1Title: "Ranking Logic:", manualS2B1Desc: "Choose Points or Wins priority. Auto calculates Head-to-Head.", manualS2B2Title: "Fair Ref & Rest:", manualS2B2Desc: "Maximizes rest time and distributes referee duties fairly. (Consecutive matches may occur depending on the player count).", manualS2B3Title: "Safe Image Export (Common):", manualS2B3Desc: "Tap the Save Image button at the bottom to open a pop-up modal. You can safely save brackets, standings, and scorecards to your gallery on both Android and iOS.", manualSec3Title: "🏆 Tournament", manualS3B1Title: "Auto BYEs & Snake Seed:", manualS3B1Desc: "Creates 8~256 bracket and separates strong players.", manualS3B2Title: "League Integration:", manualS3B2Desc: "Automatically import players based on their league rankings to easily create Upper/Lower brackets.", manualS3B3Title: "Scorecards & Bracket Export:", manualS3B3Desc: "Tap a match to export a 1:1 referee scorecard, or use the bottom button to save the entire bracket progress as an image.", manualS3B4Title: "Winner Selection System:", manualS3B4Desc: "Tap winner to advance. You can change the winner anytime by tapping the match card again."
  }
};

const TranslationContext = createContext();

const KEYS = {
  LOCALE:     'APP_LOCALE',
  PLAYERS:    'GLOBAL_PLAYERS',
  L_SESSIONS: 'LEAGUE_SESSIONS_V6',
  L_RANK_SYS: 'LEAGUE_RANKING_SYSTEM',
  L_TEMPLATES:'LEAGUE_SAVED_TEMPLATES', 
  T_SESSIONS: 'TOURNEY_SESSIONS_V7' 
};

function getStandardBracketOrder(size) {
  let order = [1, 2];
  let currentSize = 2;
  while (currentSize < size) {
    let nextSize = currentSize * 2;
    let nextOrder = [];
    for (let i = 0; i < order.length; i++) {
      nextOrder.push(order[i]);
      nextOrder.push(nextSize + 1 - order[i]);
    }
    order = nextOrder;
    currentSize = nextSize;
  }
  return order;
}

export default function App() {
  const [currentScreen, setCurrentScreen] = useState('Home');
  const [globalPlayers, setGlobalPlayers] = useState([]);
  const [locale, setLocale] = useState('ko');

  useEffect(() => {
    // 🔧 수정: 웹 브라우저에서 인쇄 시 뒷부분이 잘리는 문제 해결 (CSS 동적 주입)
    if (Platform.OS === 'web') {
      const style = document.createElement('style');
      style.innerHTML = `
        @media print {
          html, body, #root { height: auto !important; min-height: 100% !important; overflow: visible !important; }
          div { overflow: visible !important; }
          ::-webkit-scrollbar { display: none; }
        }
      `;
      document.head.appendChild(style);
    }

    const initApp = async () => {
      try {
        const migrated = await AsyncStorage.getItem('__MIGRATED_V13__');
        if (!migrated) {
          await AsyncStorage.multiRemove(['ACTIVE_LEAGUE_MATCHES', 'ACTIVE_LEAGUE_PLAYERS', 'LEAGUE_SAVED_GROUPS', 'CURRENT_TOURNAMENT', 'TOURNAMENT_ROUNDS']);
          await AsyncStorage.setItem('__MIGRATED_V13__', '1');
        }

        const [[, localeVal], [, playersVal]] = await AsyncStorage.multiGet([KEYS.LOCALE, KEYS.PLAYERS]);
        if (localeVal) setLocale(localeVal);
        if (playersVal) {
          try {
            const parsedData = JSON.parse(playersVal);
            setGlobalPlayers(sortPlayers(parsedData));
          } catch (e) { setGlobalPlayers([]); }
        }
      } catch (e) { setGlobalPlayers([]); }
    };
    initApp();
  }, []);

  const toggleLocale = () => {
    const next = locale === 'ko' ? 'en' : 'ko';
    setLocale(next); AsyncStorage.setItem(KEYS.LOCALE, next);
  };

  const t = useCallback((key, params = {}) => {
    let str = translations[locale][key] || translations['ko'][key] || key;
    Object.keys(params).forEach(k => { str = str.replace(`{${k}}`, params[k]); });
    return str;
  }, [locale]);

  return (
    <SafeAreaProvider>
      <TranslationContext.Provider value={{ locale, toggleLocale, t }}>
        <SafeAreaView style={styles.safeArea}>
          <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            {currentScreen === 'Home' && <HomeScreen setScreen={setCurrentScreen} />}
            {currentScreen === 'PlayerManager' && <PlayerManagerScreen setScreen={setCurrentScreen} globalPlayers={globalPlayers} setGlobalPlayers={setGlobalPlayers} />}
            {currentScreen === 'League' && <LeagueScreen setScreen={setCurrentScreen} globalPlayers={globalPlayers} />}
            {currentScreen === 'Tournament' && <TournamentScreen setScreen={setCurrentScreen} globalPlayers={globalPlayers} />}
            {currentScreen === 'Manual' && <ManualScreen setScreen={setCurrentScreen} />}
          </KeyboardAvoidingView>
        </SafeAreaView>
      </TranslationContext.Provider>
    </SafeAreaProvider>
  );
}

function HomeScreen({ setScreen }) {
  const { t, toggleLocale } = useContext(TranslationContext);
  return (
    <View style={styles.homeContainer}>
      <TouchableOpacity style={styles.langSwitchBtn} onPress={toggleLocale}><Text style={styles.langSwitchText}>🌐 {t('langSwitch')}</Text></TouchableOpacity>
      <Text style={styles.mainLogo}>🏓</Text>
      <Text style={styles.mainTitle}>{t('appName')}</Text>
      <View style={{width: '100%', marginBottom: 30}}>
        <TouchableOpacity style={styles.menuBtn} onPress={() => setScreen('PlayerManager')}><Text style={styles.menuBtnText}>{t('playerDbBtn')}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.menuBtn, {backgroundColor: '#1A73E8'}]} onPress={() => setScreen('League')}><Text style={styles.menuBtnText}>{t('leagueBtn')}</Text></TouchableOpacity>
        <TouchableOpacity style={[styles.menuBtn, {backgroundColor: '#FBBC04'}]} onPress={() => setScreen('Tournament')}><Text style={styles.menuBtnText}>{t('tournamentBtn')}</Text></TouchableOpacity>
      </View>
      <TouchableOpacity style={styles.manualMenuBtn} onPress={() => setScreen('Manual')}><Text style={styles.manualMenuBtnText}>{t('manualBtn')}</Text></TouchableOpacity>
    </View>
  );
}

function ManualScreen({ setScreen }) {
  const { t, locale } = useContext(TranslationContext);
  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}><TouchableOpacity onPress={() => setScreen('Home')}><Text style={styles.backBtn}>{t('backToMain')}</Text></TouchableOpacity><Text style={styles.headerTitle}>{t('manualTitle')}</Text><View style={{width: 50}} /></View>
      <ScrollView contentContainerStyle={styles.manualContent} showsVerticalScrollIndicator={false}>
        <View style={styles.manualSection}>
          <Text style={styles.manualSectionTitle}>{t('manualSec1Title')}</Text>
          <View style={styles.manualBox}>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS1B1Title')}</Text> {t('manualS1B1Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS1B4Title')}</Text> {t('manualS1B4Desc')}</Text>
          </View>
        </View>
        <View style={styles.manualSection}>
          <Text style={styles.manualSectionTitle}>{t('manualSec2Title')}</Text>
          <View style={styles.manualBox}>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS2B0Title')}</Text> {t('manualS2B0Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS2B1Title')}</Text> {t('manualS2B1Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS2B2Title')}</Text> {t('manualS2B2Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS2B3Title')}</Text> {t('manualS2B3Desc')}</Text>
          </View>
        </View>
        <View style={styles.manualSection}>
          <Text style={styles.manualSectionTitle}>{t('manualSec3Title')}</Text>
          <View style={styles.manualBox}>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS3B1Title')}</Text> {t('manualS3B1Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS3B2Title')}</Text> {t('manualS3B2Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS3B3Title')}</Text> {t('manualS3B3Desc')}</Text>
            <Text style={styles.manualText}>• <Text style={styles.boldText}>{t('manualS3B4Title')}</Text> {t('manualS3B4Desc')}</Text>
          </View>
        </View>
        <View style={{ marginTop: 20, alignItems: 'center', paddingBottom: 20 }}>
          <Text style={{ fontSize: 14, fontWeight: 'bold', color: '#1A73E8', textAlign: 'center' }}>
            {locale === 'en' 
              ? 'Created by: Gyuam TT Club Cheongmasanseong, Buyeo-gun, South Korea' 
              : '만든이: 대한민국 충청남도 부여군 규암탁구동호회 청마산성'}
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

function PlayerManagerScreen({ setScreen, globalPlayers, setGlobalPlayers }) {
  const { t } = useContext(TranslationContext);
  const [name, setName] = useState('');
  const [selectedClub, setSelectedClub] = useState(null); 
  const [isAddClubModal, setIsAddClubModal] = useState(false);
  const [newClubName, setNewClubName] = useState('');
  const [importText, setImportText] = useState('');
  const [isImportModal, setIsImportModal] = useState(false);
  const [isExportModal, setIsExportModal] = useState(false);

  const clubs = useMemo(() => {
    const set = new Set(globalPlayers.map(p => p.club || DEFAULT_CLUB_KEY));
    return [...set].sort();
  }, [globalPlayers]);

  const displayedPlayers = useMemo(() => {
    if (!selectedClub) return globalPlayers;
    return globalPlayers.filter(p => p.club === selectedClub);
  }, [globalPlayers, selectedClub]);

  const saveToDB = async (newList) => {
    const sortedList = sortPlayers(newList);
    setGlobalPlayers(sortedList);
    try { await AsyncStorage.setItem(KEYS.PLAYERS, JSON.stringify(sortedList)); } catch (e) {}
  };

  const addPlayer = () => {
    const trimmed = name.trim();
    if (!trimmed) { Alert.alert(t('notice'), t('enterName')); return; }
    const isDuplicate = globalPlayers.some(p => normalizeName(p) === normalizeName(trimmed));
    if (isDuplicate) { Alert.alert(t('notice'), t('alreadyRegistered')); return; }
    saveToDB([...globalPlayers, { name: trimmed, club: selectedClub || DEFAULT_CLUB_KEY }]);
    setName('');
  };

  const addClub = () => {
    const trimmed = newClubName.trim();
    if (!trimmed || clubs.includes(trimmed)) return;
    setSelectedClub(trimmed); setNewClubName(''); setIsAddClubModal(false);
    Alert.alert(t('notice'), t('clubCreateHint')); 
  };

  const handleExportTarget = async (targetClub) => {
    const listToExport = targetClub === 'ALL' ? globalPlayers : globalPlayers.filter(p => p.club === targetClub);
    if (listToExport.length === 0) return;
    const exportText = listToExport.map(p => `[${getDisplayClubName(p.club, t)}] ${p.name}`).join('\n');
    try { await Share.share({ message: `[Player List]\n${exportText}` }); setIsExportModal(false); } catch (e) {}
  };

  const handleImport = () => {
    const rawLines = importText.split('\n').map(s => s.trim()).filter(s => s !== '' && !s.startsWith('[Player List]'));
    if (rawLines.length === 0) { Alert.alert(t('notice'), t('noPlayerImport')); return; }
    const uniqueMap = new Map();
    globalPlayers.forEach(p => uniqueMap.set(normalizeName(p), p));
    let addedCount = 0;
    rawLines.forEach(line => {
       const match = line.match(/^\[([^\]]+)\]\s*(.+)$/);
       let pName = line, pClub = selectedClub || DEFAULT_CLUB_KEY;
       if (match) { pClub = match[1].trim(); pName = match[2].trim(); if (pClub === t('defaultClub')) pClub = DEFAULT_CLUB_KEY; }
       const key = normalizeName(pName);
       if (!uniqueMap.has(key)) { uniqueMap.set(key, { name: pName, club: pClub }); addedCount++; }
    });
    if (addedCount === 0) { Alert.alert(t('notice'), t('alreadyRegistered')); return; }
    
    // 🔧 수정: 웹 환경에서 Alert 사용시 취소버튼(style: 'cancel')이 명시되지 않으면 무시되는 버그 해결
    Alert.alert(t('import'), t('importConfirm', { count: addedCount }), [
      { text: t('cancel'), style: 'cancel' }, 
      { text: t('apply'), onPress: () => {
        saveToDB(Array.from(uniqueMap.values())); setImportText(''); setIsImportModal(false);
      }}
    ]);
  };

  const renderPlayerItem = ({ item }) => (
    <View style={styles.playerListItem}>
      <View>
        <Text style={styles.playerListName}>{item.name}</Text>
        <Text style={styles.playerListSub}>[{getDisplayClubName(item.club, t)}]</Text>
      </View>
      <TouchableOpacity style={styles.playerDeleteBtn} onPress={() => saveToDB(globalPlayers.filter(x => x.name !== item.name))}><Text style={{color:'#EA4335', fontWeight:'bold'}}>{t('delete')}</Text></TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setScreen('Home')}><Text style={styles.backBtn}>{t('backToMain')}</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('playerManagerTitle')}</Text>
        <View style={{flexDirection: 'row', alignItems: 'center'}}>
          <TouchableOpacity onPress={() => setIsAddClubModal(true)} style={{marginRight: 15}}><Text style={[styles.backBtn, { color: '#34A853' }]}>{t('addClubBtn')}</Text></TouchableOpacity>
          <TouchableOpacity onPress={() => setIsExportModal(true)}><Text style={styles.backBtn}>{t('export')}</Text></TouchableOpacity>
        </View>
      </View>

      <View style={{height: 55}}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.clubTabBar} contentContainerStyle={{ paddingHorizontal: 15, alignItems: 'center' }}>
          <TouchableOpacity style={[styles.clubTab, !selectedClub && styles.clubTabActive]} onPress={() => setSelectedClub(null)}><Text style={[styles.clubTabText, !selectedClub && styles.clubTabTextActive]}>{t('all')} {globalPlayers.length}</Text></TouchableOpacity>
          {clubs.map(c => {
            const count = globalPlayers.filter(p => p.club === c).length;
            const isActive = selectedClub === c;
            return ( <TouchableOpacity key={c} style={[styles.clubTab, isActive && styles.clubTabActive]} onPress={() => setSelectedClub(c)}><Text style={[styles.clubTabText, isActive && styles.clubTabTextActive]}>{getDisplayClubName(c, t)} {count}</Text></TouchableOpacity> );
          })}
        </ScrollView>
      </View>

      <View style={{padding: 20, paddingBottom: 10}}>
        {selectedClub && <Text style={styles.addingToClubHint}>{t('addingToClubHint', { club: getDisplayClubName(selectedClub, t) })}</Text>}
        <View style={styles.inputRow}>
          <TextInput style={styles.input} placeholder={t('nameInputPlaceholder')} placeholderTextColor="#999" value={name} onChangeText={setName} maxLength={12} />
          <TouchableOpacity style={styles.addBtn} onPress={addPlayer}><Text style={styles.addBtnText}>{t('add')}</Text></TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.importBtn} onPress={() => setIsImportModal(true)}><Text style={styles.importBtnText}>{t('pasteListBtn')}</Text></TouchableOpacity>
      </View>

      <FlatList data={displayedPlayers} keyExtractor={item => item.name} renderItem={renderPlayerItem} contentContainerStyle={{paddingHorizontal: 20, paddingBottom: 50}} initialNumToRender={20} maxToRenderPerBatch={20} windowSize={10} />

      <Modal visible={isExportModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, { maxHeight: '70%', padding: 25 }]}>
            <Text style={styles.sectionTitle}>{t('exportSelectTitle')}</Text>
            <ScrollView style={{ marginTop: 10, marginBottom: 20 }}>
              <TouchableOpacity style={styles.exportListItem} onPress={() => handleExportTarget('ALL')}><Text style={styles.exportListText}>🌟 {t('exportAllPlayers')} ({globalPlayers.length})</Text></TouchableOpacity>
              {clubs.map(c => {
                const count = globalPlayers.filter(p => p.club === c).length;
                return ( <TouchableOpacity key={c} style={styles.exportListItem} onPress={() => handleExportTarget(c)}><Text style={styles.exportListText}>📁 [{getDisplayClubName(c, t)}] ({count})</Text></TouchableOpacity> )
              })}
            </ScrollView>
            <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#ccc', padding: 12, borderRadius: 8, alignItems: 'center'}]} onPress={() => setIsExportModal(false)}><Text>{t('cancel')}</Text></TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal visible={isImportModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, {height: '60%'}]}>
            <Text style={styles.sectionTitle}>{t('pasteListTitle')}</Text>
            <TextInput style={styles.textArea} multiline placeholder={t('pastePlaceholder')} placeholderTextColor="#999" value={importText} onChangeText={setImportText} />
            <View style={{flexDirection: 'row', marginTop: 20}}>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#ccc', padding: 10, borderRadius: 5, marginRight: 10}]} onPress={() => setIsImportModal(false)}><Text>{t('cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#1A73E8', padding: 10, borderRadius: 5}]} onPress={handleImport}><Text style={{color:'#fff'}}>{t('import')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isAddClubModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, {padding: 30}]}>
            <Text style={styles.sectionTitle}>{t('newClubTitle')}</Text>
            <TextInput style={[styles.input, { flex: 0, width: '100%', marginBottom: 25, fontSize: 16 }]} placeholder={t('clubNamePlaceholder')} placeholderTextColor="#999" value={newClubName} onChangeText={setNewClubName} maxLength={15} />
            <View style={{ flexDirection: 'row', gap: 15 }}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#ccc', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={() => setIsAddClubModal(false)}><Text>{t('cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#34A853', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={addClub}><Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('add')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}


// ==========================================
// 🏆 토너먼트 
// ==========================================
const TournamentMatchCard = React.memo(({ m, rIdx, mIdx, isFinal, onSelect }) => {
  const { t } = useContext(TranslationContext);
  if (!m || (m.p1 === 'BYE' && m.p2 === 'BYE')) return <View style={[styles.matchWrapper, { opacity: 0 }]} />;
  
  const p1Display = m.p1 === 'WAITING' ? t('waiting') : m.p1 === 'BYE' ? t('bye') : m.p1;
  const p2Display = m.p2 === 'WAITING' ? t('waiting') : m.p2 === 'BYE' ? t('bye') : m.p2;
  return (
    <View style={styles.matchWrapper}>
      <TouchableOpacity 
        style={[styles.treeMatchCard, m.winner && {borderColor: '#34A853'}]}
        disabled={m.p1 === 'WAITING' || m.p2 === 'WAITING' || m.p1 === 'BYE' || m.p2 === 'BYE'}
        onPress={() => onSelect(rIdx, mIdx, m.p1, m.p2)}
      >
        <View style={[styles.playerSlot, m.winner === m.p1 && styles.winnerSlot]}><Text style={[styles.treePlayerText, m.winner === m.p1 && {color: '#fff', fontWeight:'bold'}]}>{p1Display}</Text></View>
        <View style={styles.treeDivider} />
        <View style={[styles.playerSlot, m.winner === m.p2 && styles.winnerSlot]}><Text style={[styles.treePlayerText, m.winner === m.p2 && {color: '#fff', fontWeight:'bold'}]}>{p2Display}</Text></View>
      </TouchableOpacity>
      {!isFinal && <View style={styles.connectorLine} />}
    </View>
  );
});

function TournamentScreen({ setScreen, globalPlayers }) {
  const { t, locale } = useContext(TranslationContext); 
  
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [selectedClub, setSelectedClub] = useState(null); 
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedMatch, setSelectedMatch] = useState(null);
  const [isTourneySaveModal, setIsTourneySaveModal] = useState(false);
  const [isAddSessionModal, setIsAddSessionModal] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState('');
  
  const isLoadedRef = useRef(false);
  const debounceTimerRef = useRef(null);
  const captureViewRef = useRef();
  const singleScorecardRef = useRef(); 

  useEffect(() => {
    const loadData = async () => {
      try {
        const sessionData = await AsyncStorage.getItem(KEYS.T_SESSIONS);
        let loadedSessions = [];
        if (sessionData) { loadedSessions = JSON.parse(sessionData) || []; }
        
        if (loadedSessions.length === 0) {
           loadedSessions = [
             { id: 't1', name: t('integrated'), isActive: false, importMode: false, rankStart: '1', rankEnd: '2', importedPlayers: null, numPlayers: '4', numGroups: '1', seeds: {}, size: 8, entryList: [], rounds: [] },
             { id: 't2', name: t('upperBracket'), isActive: false, importMode: false, rankStart: '1', rankEnd: '2', importedPlayers: null, numPlayers: '4', numGroups: '1', seeds: {}, size: 8, entryList: [], rounds: [] },
             { id: 't3', name: t('lowerBracket'), isActive: false, importMode: false, rankStart: '3', rankEnd: '4', importedPlayers: null, numPlayers: '4', numGroups: '1', seeds: {}, size: 8, entryList: [], rounds: [] }
           ];
        }
        setSessions(loadedSessions);
        setActiveSessionId(loadedSessions[0].id);
        isLoadedRef.current = true;
      } catch (error) { isLoadedRef.current = true; }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!isLoadedRef.current || sessions.length === 0) return;
    debounceTimerRef.current = setTimeout(() => { 
      AsyncStorage.setItem(KEYS.T_SESSIONS, JSON.stringify(sessions)).catch(() => {}); 
    }, 500);
    return () => clearTimeout(debounceTimerRef.current);
  }, [sessions]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const updateActiveSession = (newProps) => { setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, ...newProps } : s)); };

  const clubs = useMemo(() => {
    const set = new Set(globalPlayers.map(p => p.club || DEFAULT_CLUB_KEY));
    return [...set].sort();
  }, [globalPlayers]);

  const addNewSession = () => {
    const sName = sessionNameInput.trim() || `${sessions.length + 1}조`;
    const newS = { id: Date.now().toString(), name: sName, isActive: false, importMode: false, rankStart: '1', rankEnd: '2', importedPlayers: null, numPlayers: '4', numGroups: '1', seeds: {}, size: 8, entryList: [], rounds: [] };
    const updated = [...sessions, newS];
    setSessions(updated); setActiveSessionId(newS.id); setIsAddSessionModal(false); setSessionNameInput('');
  };

  const deleteActiveSession = () => {
    if (sessions.length <= 1) { Alert.alert(t('error'), '최소 1개의 그룹은 있어야 합니다.'); return; }
    Alert.alert(t('delGroup'), `'${activeSession.name}'를 삭제하시겠습니까?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => {
          const updated = sessions.filter(s => s.id !== activeSessionId);
          setSessions(updated); setActiveSessionId(updated[0].id);
      }}
    ]);
  };

  const handleImportLeague = async () => {
    try { 
      const [[, sessionsData], [, rankSysVal]] = await AsyncStorage.multiGet([KEYS.L_SESSIONS, KEYS.L_RANK_SYS]);
      const leagueSessions = sessionsData ? JSON.parse(sessionsData) : [];
      const rankSys = rankSysVal || 'points';

      let extracted = [];
      let rankGroups = {}; 
      const min = parseInt(activeSession.rankStart) || 1;
      const max = parseInt(activeSession.rankEnd) || 1;

      leagueSessions.forEach(s => {
        const matchMap = {};
        s.matches.forEach(m => { matchMap[getMatchKey(m.p1, m.p2)] = m; });
        const st = calculateStandingsData(s.players, s.matches, rankSys, matchMap, s.tieBreakers || {});
        st.forEach(p => {
          if (p.rank >= min && p.rank <= max) {
              extracted.push(p.name);
              if (!rankGroups[p.internalRank]) rankGroups[p.internalRank] = [];
              rankGroups[p.internalRank].push(p.name);
          }
        });
      });

      if (extracted.length === 0) { Alert.alert(t('notice'), t('noImportData')); return; }

      let newSeeds = {};
      let currentSeed = 1;
      const sortedRanks = Object.keys(rankGroups).map(Number).sort((a,b)=>a-b);
      
      sortedRanks.forEach(r => {
          const playersInRank = rankGroups[r];
          playersInRank.forEach(player => {
              newSeeds[currentSeed] = player;
              currentSeed++;
          });
      });

      updateActiveSession({ importedPlayers: extracted, numPlayers: String(extracted.length), seeds: newSeeds });
      Alert.alert(t('notice'), t('importSuccess', {count: extracted.length}));
    } catch (error) { Alert.alert(t('error'), t('noImportData')); }
  };

  const bracketSize = useMemo(() => {
    const n = parseInt(activeSession?.numPlayers, 10) || 0; 
    if (n <= 8) return 8; if (n <= 16) return 16; if (n <= 32) return 32;
    if (n <= 64) return 64; if (n <= 128) return 128; return 256;
  }, [activeSession?.numPlayers]);

  const numByes = useMemo(() => Math.max(0, bracketSize - (parseInt(activeSession?.numPlayers, 10) || 0)), [bracketSize, activeSession?.numPlayers]);

  const seedHints = useMemo(() => {
    const total = parseInt(activeSession?.numPlayers, 10) || 0;
    if (total > 256) return [];
    if (activeSession?.importMode) {
      let hints = []; for(let i=0; i<total; i++) hints.push(`${i+1}순위`); return hints;
    }
    const groups = parseInt(activeSession?.numGroups, 10) || 1;
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let hints = [], rank = 1, groupIdx = 0, forward = true;
    for (let i = 0; i < total; i++) {
      hints.push(t('groupRank', { group: alphabet[groupIdx % 26], rank: rank }));
      if (forward) {
        groupIdx++;
        if (groupIdx >= groups) { groupIdx = groups - 1; forward = false; rank++; }
      } else {
        groupIdx--;
        if (groupIdx < 0) { groupIdx = 0; forward = true; rank++; }
      }
    }
    return hints;
  }, [activeSession?.numPlayers, activeSession?.numGroups, activeSession?.importMode, t]);

  const startTournament = () => {
    const n = parseInt(activeSession.numPlayers, 10) || 0;
    if (n < 2) { Alert.alert(t('error'), t('minPlayersReq')); return; }
    if (n > 256) { Alert.alert(t('error'), t('maxPlayersReq')); updateActiveSession({numPlayers: '256'}); return; }

    let seedsList = new Array(bracketSize).fill('BYE');
    const assignedNames = Object.values(activeSession.seeds).filter(p => p !== 'UNSELECTED');
    
    Object.keys(activeSession.seeds).forEach((seedNum) => {
      if (activeSession.seeds[seedNum] !== 'UNSELECTED') seedsList[parseInt(seedNum) - 1] = activeSession.seeds[seedNum];
    });

    const pool = activeSession.importMode && activeSession.importedPlayers 
        ? activeSession.importedPlayers 
        : globalPlayers.map(p=>p.name);

    const remainingPlayers = shuffleArray(pool.filter(name => !assignedNames.includes(name)));
    let remainIdx = 0;
    for (let i = 0; i < n; i++) {
      if (seedsList[i] === 'BYE' && remainIdx < remainingPlayers.length) {
        seedsList[i] = remainingPlayers[remainIdx++];
      }
    }

    const order = getStandardBracketOrder(bracketSize);
    let entryList = new Array(bracketSize).fill('BYE');
    for (let i = 0; i < bracketSize; i++) { entryList[i] = seedsList[order[i] - 1]; }

    let initialRounds = [];
    let currentRoundSize = bracketSize;
    while (currentRoundSize >= 2) {
      let matchCount = currentRoundSize / 2;
      let roundMatches = [];
      for (let i = 0; i < matchCount; i++) {
        if (currentRoundSize === bracketSize) {
          let p1 = entryList[i * 2] || 'WAITING'; 
          let p2 = entryList[i * 2 + 1] || 'WAITING';
          let winner = (p1 !== 'BYE' && p2 === 'BYE') ? p1 : (p2 !== 'BYE' && p1 === 'BYE') ? p2 : null;
          if (p1 === 'BYE' && p2 === 'BYE') winner = 'BYE';
          roundMatches.push({ id: `R${currentRoundSize}-M${i}`, p1, p2, winner });
        } else { roundMatches.push({ id: `R${currentRoundSize}-M${i}`, p1: 'WAITING', p2: 'WAITING', winner: null }); }
      }
      initialRounds.push(roundMatches);
      currentRoundSize /= 2;
    }
    for (let i = 0; i < initialRounds[0].length; i++) {
      if (initialRounds[0][i].winner && initialRounds[1]) {
        let nIdx = Math.floor(i / 2), nPos = i % 2 === 0 ? 'p1' : 'p2';
        initialRounds[1][nIdx][nPos] = initialRounds[0][i].winner;
      }
    }
    updateActiveSession({ size: bracketSize, entryList, rounds: initialRounds, isActive: true });
  };

  const selectWinner = (name) => {
    if (!selectedMatch || !name || name === 'WAITING' || name === 'BYE') return; 
    let newRounds = JSON.parse(JSON.stringify(activeSession.rounds));
    const { rIdx, mIdx } = selectedMatch;
    const oldWinner = newRounds[rIdx][mIdx].winner;

    let isDownstreamPlayed = false;
    if (oldWinner && oldWinner !== name) {
        let tempR = rIdx + 1;
        let tempM = Math.floor(mIdx / 2);
        while(tempR < newRounds.length) {
            if (newRounds[tempR][tempM].winner === oldWinner) {
                isDownstreamPlayed = true;
                break;
            }
            tempM = Math.floor(tempM / 2);
            tempR++;
        }
    }

    const applyWin = () => {
      const processWin = (currentName, currentRIdx, currentMIdx) => {
        const prevWinner = newRounds[currentRIdx][currentMIdx].winner;
        newRounds[currentRIdx][currentMIdx].winner = currentName;
        
        if (prevWinner && prevWinner !== currentName) {
           let tempR = currentRIdx + 1;
           let tempM = Math.floor(currentMIdx / 2);
           let tempPos = currentMIdx % 2 === 0 ? 'p1' : 'p2';
           while(tempR < newRounds.length) {
              if (newRounds[tempR][tempM][tempPos] === prevWinner) {
                  newRounds[tempR][tempM][tempPos] = 'WAITING';
                  if(newRounds[tempR][tempM].winner === prevWinner) {
                      newRounds[tempR][tempM].winner = null;
                  }
                  tempPos = tempM % 2 === 0 ? 'p1' : 'p2';
                  tempM = Math.floor(tempM / 2);
                  tempR++;
              } else { break; }
           }
        }

        if (currentRIdx + 1 < newRounds.length) {
          const nIdx = Math.floor(currentMIdx / 2), nPos = currentMIdx % 2 === 0 ? 'p1' : 'p2';
          newRounds[currentRIdx + 1][nIdx][nPos] = currentName;
          
          const nextMatch = newRounds[currentRIdx + 1][nIdx];
          if (nextMatch.p1 === 'BYE' && nextMatch.p2 !== 'BYE' && nextMatch.p2 !== 'WAITING') {
              processWin(nextMatch.p2, currentRIdx + 1, nIdx);
          } else if (nextMatch.p2 === 'BYE' && nextMatch.p1 !== 'BYE' && nextMatch.p1 !== 'WAITING') {
              processWin(nextMatch.p1, currentRIdx + 1, nIdx);
          }
        }
      };
      
      processWin(name, rIdx, mIdx);
      
      const updatedSession = { ...activeSession, rounds: newRounds };
      updateActiveSession({ rounds: newRounds });
      
      const newSessions = sessions.map(s => s.id === activeSessionId ? updatedSession : s);
      AsyncStorage.setItem(KEYS.T_SESSIONS, JSON.stringify(newSessions)).catch(() => {});

      setModalVisible(false);
      setSelectedMatch(null); 
    };

    if (isDownstreamPlayed) {
      Alert.alert(
        "경고", 
        "이미 상위 라운드가 진행 중입니다.\n승자를 번복하면 연관된 상위 라운드의 경기 결과가 모두 초기화됩니다.\n정말 번복하시겠습니까?", 
        [{ text: "취소", style: "cancel" }, { text: "확인", style: 'destructive', onPress: applyWin }]
      );
    } else { applyWin(); }
  };
  
  const resetTournament = () => {
      Alert.alert(t('resetAlertTitle'), t('resetAlertDesc'), [
        { text: t('cancel'), style: 'cancel' },
        { text: t('reset'), onPress: () => {
            updateActiveSession({ rounds: [], entryList: [], isActive: false });
        }}
      ])
  }

  const captureAndSaveImage = async (targetRef, isLarge = false) => {
    try {
      if (!targetRef.current) return;
      Keyboard.dismiss(); 
      const captureQuality = isLarge ? 0.4 : 0.8;
      const localUri = await captureRef(targetRef, { format: 'png', quality: captureQuality });
 
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = localUri;
        link.download = `탁구대회_결과_${Date.now()}.png`; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status !== 'granted') { Alert.alert(t('needPermission'), t('permissionDesc')); return; }
        await MediaLibrary.saveToLibraryAsync(localUri);
        Alert.alert(t('saveSuccess'), t('saveImageSuccess'));
      }
    } catch (error) { Alert.alert(t('error'), t('saveFailed')); }
  };

  const handlePrint = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'web') { window.print(); } 
    else { Alert.alert("알림", "PC 환경에서만 인쇄 기능이 지원됩니다."); }
  };

  if (activeSession?.isActive && activeSession.rounds && activeSession.rounds.length > 0) {
    const rounds = activeSession.rounds;

    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => updateActiveSession({isActive: false})}><Text style={styles.backBtn}>{t('backToSetup')}</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>{t('bracketBoard', { groupName: activeSession.name })}</Text>
          <TouchableOpacity onPress={resetTournament}><Text style={[styles.backBtn, {color: '#EA4335'}]}>{t('reset')}</Text></TouchableOpacity>
        </View>

        <View style={styles.sessionTabContainer}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center', paddingHorizontal: 15}}>
            {sessions.map(s => (
              <TouchableOpacity key={s.id} style={[styles.sessionTab, activeSessionId === s.id && styles.sessionTabActive]} onPress={() => setActiveSessionId(s.id)}>
                <Text style={[styles.sessionTabText, activeSessionId === s.id && styles.sessionTabTextActive]}>{s.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <ScrollView horizontal={false} removeClippedSubviews={true} style={{ flex: 1, backgroundColor: '#fcfcfc' }}>
          <ScrollView horizontal={true} removeClippedSubviews={true} contentContainerStyle={{ padding: 20, paddingBottom: 400 }}>
            <View ref={captureViewRef} collapsable={false} style={styles.bracketBoard}>
              <Text style={[styles.roundTitle, {position: 'absolute', top: 10, left: 20, fontSize: 18}]}>{t('tournamentBracket', { groupName: activeSession.name, size: activeSession.size })}</Text>
              <View style={{ flexDirection: 'row', marginTop: 40 }}>
                {rounds.map((round, rIdx) => {
                  const isFinal = (rIdx === rounds.length - 1);
                  const roundName = isFinal ? t('finals') : t('roundOf', { size: Math.pow(2, rounds.length - rIdx) });
                  return (
                    <View key={`round-${rIdx}`} style={styles.roundColumn}>
                      <Text style={styles.roundTitle}>{roundName}</Text>
                      <View style={styles.matchesColumn}>
                        {round.map((m, mIdx) => ( <TournamentMatchCard key={m ? m.id : `empty-${mIdx}`} m={m} rIdx={rIdx} mIdx={mIdx} isFinal={isFinal} onSelect={(r, mId, p1, p2) => { setSelectedMatch({ rIdx: r, mIdx: mId, p1, p2 }); setModalVisible(true); }} /> ))}
                      </View>
                    </View>
                  );
                })}
              </View>
            </View>
          </ScrollView>
        </ScrollView>
        
        <View style={styles.actionRow}>
          <TouchableOpacity style={[styles.actionBtnShare, { backgroundColor: '#5F6368' }]} onPress={handlePrint}>
            <Text style={styles.actionBtnText}>🖨️ 결과 인쇄하기</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.actionBtnImage} onPress={() => setIsTourneySaveModal(true)}>
            <Text style={styles.actionBtnText}>📸 결과 이미지로 저장</Text>
          </TouchableOpacity>
        </View>

        <Modal visible={isTourneySaveModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalBox}>
              <Text style={styles.sectionTitle}>{t('selectSaveOption')}</Text>
              <TouchableOpacity style={styles.exportListItem} onPress={() => { captureAndSaveImage(captureViewRef, activeSession.size >= 64); setIsTourneySaveModal(false); }}>
                <Text style={styles.exportListText}>📸 {t('saveFullImage')}</Text>
              </TouchableOpacity>
              
              <Text style={{fontSize: 12, color: '#EA4335', marginTop: 15, textAlign: 'center'}}>
                ※ 웹 브라우저나 대규모 대진표(64강 이상) 캡처 시 화면이 잘릴 수 있습니다. 가급적 [결과 인쇄하기(PDF 저장)]를 권장합니다.
              </Text>

              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#ccc', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 15}]} onPress={() => setIsTourneySaveModal(false)}>
                <Text>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={modalVisible} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalBox}>
              <Text style={{fontSize: 18, fontWeight: 'bold', marginBottom: 20}}>{t('selectWinner')}</Text>
              <View style={{flexDirection: 'row', justifyContent: 'space-around', width: '100%'}}>
                <TouchableOpacity style={styles.winnerBtn} onPress={() => selectWinner(selectedMatch?.p1)}><Text style={styles.winnerBtnText}>{selectedMatch?.p1 === 'WAITING' ? t('wait') : selectedMatch?.p1 || t('wait')}</Text></TouchableOpacity>
                <TouchableOpacity style={styles.winnerBtn} onPress={() => selectWinner(selectedMatch?.p2)}><Text style={styles.winnerBtnText}>{selectedMatch?.p2 === 'WAITING' ? t('wait') : selectedMatch?.p2 || t('wait')}</Text></TouchableOpacity>
              </View>
              <View style={{flexDirection: 'row', marginTop: 30, justifyContent: 'center', alignItems: 'center', gap: 30}}>
                <TouchableOpacity onPress={() => setModalVisible(false)}><Text style={{color: '#888', fontSize: 16}}>{t('cancel')}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => captureAndSaveImage(singleScorecardRef, false)}><Text style={{color: '#1A73E8', fontSize: 16, fontWeight: 'bold'}}>기록지 출력</Text></TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>

        <View style={{ position: 'absolute', top: -10000, left: 0, opacity: 0 }}>
          <View ref={singleScorecardRef} collapsable={false} style={{ width: 400, backgroundColor: '#fff', padding: 20 }}>
            {selectedMatch && (() => {
              const rIdx = selectedMatch.rIdx;
              const isFinal = (rIdx === activeSession.rounds.length - 1);
              const roundName = isFinal ? t('finals') : t('roundOf', { size: Math.pow(2, activeSession.rounds.length - rIdx) });
              const matchNum = selectedMatch.mIdx + 1;
              const p1Display = selectedMatch.p1 === 'WAITING' ? t('waiting') : selectedMatch.p1;
              const p2Display = selectedMatch.p2 === 'WAITING' ? t('waiting') : selectedMatch.p2;

              return (
                <View style={{ width: '100%', borderWidth: 2, borderColor: '#000', padding: 15, borderRadius: 10 }}>
                  <Text style={{ fontSize: 20, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 }}>{t('matchScorecardTitle', { groupName: activeSession?.name })}</Text>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#ccc', paddingBottom: 10, marginBottom: 15 }}>
                    <Text style={{ fontSize: 16, fontWeight: 'bold' }}>{roundName} - {matchNum}경기</Text>
                    <Text style={{ fontSize: 14 }}>{t('matchRefAndTable', { ref: '________' })}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center', color: '#000' }}>{p1Display}</Text>
                    <Text style={{ fontSize: 16, color: '#666', marginHorizontal: 10 }}>VS</Text>
                    <Text style={{ fontSize: 20, fontWeight: 'bold', flex: 1, textAlign: 'center', color: '#000' }}>{p2Display}</Text>
                  </View>
                  {[1,2,3,4,5].map(g => (
                    <View key={`g-${g}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                      <Text style={{ width: 60, fontSize: 14, fontWeight: '500', color: '#555' }}>{t('gameNum', { num: g })}</Text>
                      <View style={{ width: 60, height: 35, borderWidth: 1, borderColor: '#aaa', borderRadius: 5 }} />
                      <Text style={{ marginHorizontal: 15, fontSize: 16 }}> : </Text>
                      <View style={{ width: 60, height: 35, borderWidth: 1, borderColor: '#aaa', borderRadius: 5 }} />
                    </View>
                  ))}
                  <View style={{ borderTopWidth: 2, borderColor: '#000', paddingTop: 15, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontWeight: 'bold', marginRight: 15, fontSize: 14 }}>{t('finalScore')}</Text>
                    <View style={{ width: 50, height: 35, borderWidth: 3, borderColor: '#000', borderRadius: 5 }} />
                    <Text style={{ marginHorizontal: 10, fontSize: 16 }}>:</Text>
                    <View style={{ width: 50, height: 35, borderWidth: 3, borderColor: '#000', borderRadius: 5 }} />
                  </View>
                  <View style={{ marginTop: 15, alignItems: 'center' }}>
                    <Text style={{ fontWeight: 'bold', fontSize: 14 }}>{t('finalWinner')}</Text>
                  </View>
                </View>
              );
            })()}
          </View>
        </View>

      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setScreen('Home')}><Text style={styles.backBtn}>{t('backToMain')}</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('tournamentSetupTitle', { groupName: activeSession?.name || '' })}</Text>
        {activeSession?.rounds && activeSession.rounds.length > 0 ? (
          <TouchableOpacity onPress={() => updateActiveSession({isActive: true})}><Text style={[styles.backBtn, { color: '#34A853' }]} >{t('goToActiveGame')}</Text></TouchableOpacity>
        ) : (<View style={{width: 50}} />)}
      </View>

      <View style={styles.sessionTabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center', paddingHorizontal: 15}}>
          {sessions.map(s => (
            <TouchableOpacity key={s.id} style={[styles.sessionTab, activeSessionId === s.id && styles.sessionTabActive]} onPress={() => setActiveSessionId(s.id)}>
              <Text style={[styles.sessionTabText, activeSessionId === s.id && styles.sessionTabTextActive]}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.sessionTabAdd} onPress={() => setIsAddSessionModal(true)}>
            <Text style={styles.sessionTabAddText}>{t('addGroup')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{padding: 20, paddingBottom: 100}} keyboardShouldPersistTaps="handled">
        <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
          <Text style={styles.sectionTitle}>{t('basicInfo')}</Text>
          <TouchableOpacity onPress={deleteActiveSession}><Text style={{color: '#EA4335', fontSize: 12, fontWeight: 'bold'}}>{t('delGroup')}</Text></TouchableOpacity>
        </View>

        <View style={styles.radioGroup}>
          <TouchableOpacity style={[styles.radioBtn, activeSession?.importMode && styles.radioBtnActive]} onPress={() => updateActiveSession({importMode: true})}><Text style={[styles.radioText, activeSession?.importMode && styles.radioTextActive]}>{t('importLeague')}</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.radioBtn, !activeSession?.importMode && styles.radioBtnActive]} onPress={() => updateActiveSession({importMode: false, importedPlayers: null, seeds: {}})}><Text style={[styles.radioText, !activeSession?.importMode && styles.radioTextActive]}>{t('manualSelect')}</Text></TouchableOpacity>
        </View>

        {activeSession?.importMode && (
          <View style={{backgroundColor: '#eef2f6', padding: 15, borderRadius: 8, marginBottom: 15}}>
            <View style={{flexDirection: 'row', alignItems: 'center', marginBottom: 10}}>
              <Text style={{fontWeight: 'bold', color: '#1A73E8', marginRight: 10}}>{t('rankRange')}</Text>
              <TextInput style={[styles.input, {flex: 0, width: 40, textAlign: 'center', padding: 5, minHeight: 35, borderBottomWidth: 1, backgroundColor: '#fff'}]} keyboardType="numeric" value={activeSession.rankStart} onChangeText={(v)=>updateActiveSession({rankStart: v.replace(/[^0-9]/g, '')})} />
              <Text> ~ </Text>
              <TextInput style={[styles.input, {flex: 0, width: 40, textAlign: 'center', padding: 5, minHeight: 35, borderBottomWidth: 1, backgroundColor: '#fff'}]} keyboardType="numeric" value={activeSession.rankEnd} onChangeText={(v)=>updateActiveSession({rankEnd: v.replace(/[^0-9]/g, '')})} />
              <Text style={{marginLeft: 5}}>{t('toRank')}</Text>
            </View>
            <TouchableOpacity style={{backgroundColor: '#1A73E8', padding: 10, borderRadius: 5, alignItems: 'center'}} onPress={handleImportLeague}><Text style={{color:'#fff', fontWeight:'bold'}}>{t('importBtn')}</Text></TouchableOpacity>
          </View>
        )}

        {activeSession?.importedPlayers && activeSession?.importMode ? (
          <View style={{marginBottom: 15}}>
             <Text style={styles.addingToClubHint}>{t('importedCount', {count: activeSession.importedPlayers.length})}</Text>
             <View style={[styles.tagWrap, {minHeight: 40}]}>
                {activeSession.importedPlayers.map(p => (
                  <View key={`imp-${p}`} style={[styles.tag, {backgroundColor:'#fff'}]}><Text style={{fontSize: 12}}>{p}</Text></View>
                ))}
             </View>
          </View>
        ) : null}

        {(!activeSession?.importMode) && (
          <>
            <View style={styles.inputRowBox}>
              <Text style={{flex: 1, alignSelf: 'center', fontSize: 15}}>{t('totalPlayers')}</Text>
              <TextInput 
                style={[styles.input, {flex: 0.5, textAlign:'center'}]} keyboardType="numeric" maxLength={3} 
                value={activeSession?.numPlayers || ''} 
                onChangeText={(v) => updateActiveSession({numPlayers: v.replace(/[^0-9]/g, '')})} 
              />
            </View>
            <View style={styles.inputRowBox}>
              <Text style={{flex: 1, alignSelf: 'center', fontSize: 15}}>{t('prelimGroups')}</Text>
              <TextInput style={[styles.input, {flex: 0.5, textAlign:'center'}]} keyboardType="numeric" maxLength={2} value={activeSession?.numGroups || ''} onChangeText={(v) => updateActiveSession({numGroups: v.replace(/[^0-9]/g, '')})} />
            </View>
          </>
        )}
        
        <Text style={styles.infoText}>{t('autoByeInfo', { size: bracketSize, byes: numByes })}</Text>

        <Text style={[styles.sectionTitle, {marginTop:20}]}>{t('seedAssignment')}</Text>
        
        {(!activeSession?.importMode || !activeSession?.importedPlayers) && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10, maxHeight: 50}} contentContainerStyle={{alignItems: 'center'}}>
            <TouchableOpacity style={[styles.clubTab, !selectedClub && styles.clubTabActive]} onPress={() => setSelectedClub(null)}>
              <Text style={[styles.clubTabText, !selectedClub && styles.clubTabTextActive]}>{t('all')}</Text>
            </TouchableOpacity>
            {clubs.map(c => (
              <TouchableOpacity key={c} style={[styles.clubTab, selectedClub === c && styles.clubTabActive]} onPress={() => setSelectedClub(c)}>
                <Text style={[styles.clubTabText, selectedClub === c && styles.clubTabTextActive]}>{getDisplayClubName(c, t)}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {(parseInt(activeSession?.numPlayers, 10) <= 256) && seedHints.map((hint, idx) => {
          const seedNum = idx + 1;
          const assignedPlayers = Object.values(activeSession?.seeds || {}).filter(p => p !== 'UNSELECTED');
          
          let pool = [];
          if (activeSession?.importMode && activeSession?.importedPlayers) {
            pool = activeSession.importedPlayers.map(p => ({name: p, club: DEFAULT_CLUB_KEY})); 
          } else {
            pool = globalPlayers;
          }

          const filteredObjs = pool.filter(p => {
            if (activeSession?.seeds?.[seedNum] === p.name) return true; 
            if (assignedPlayers.includes(p.name)) return false; 
            if (!activeSession?.importMode && selectedClub && p.club !== selectedClub) return false; 
            return true;
          });

          const availablePlayers = ['UNSELECTED', ...sortPlayers(filteredObjs).map(p => p.name)];

          return (
            <View key={seedNum} style={styles.seedRow}>
              <Text style={styles.seedLabel}>
                <Text style={{color:'#1A73E8', fontWeight: 'bold'}}>[{hint}]</Text> {t('seedSlot', { num: seedNum })}
              </Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
                {availablePlayers.map(p => {
                  const isSelected = activeSession?.seeds?.[seedNum] === p;
                  return (
                    <TouchableOpacity key={p} onPress={() => updateActiveSession({seeds: {...activeSession.seeds, [seedNum]: p}})} style={[styles.smallTag, isSelected && {backgroundColor: '#1A73E8'}]}>
                      <Text style={{color: isSelected ? '#fff' : '#333', fontSize: 13, fontWeight: '500'}}>{p === 'UNSELECTED' ? t('unselected') : p}</Text>
                    </TouchableOpacity>
                  )
                })}
              </ScrollView>
            </View>
          );
        })}
        <TouchableOpacity style={[styles.genBtn, {marginTop:30}]} onPress={startTournament}>
          <Text style={styles.genBtnText}>{t('genBracketBtn')}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={isAddSessionModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, {padding: 30}]}>
            <Text style={styles.sectionTitle}>{t('groupNameInputTitle')}</Text>
            <TextInput style={[styles.input, { flex: 0, width: '100%', marginBottom: 25, fontSize: 16 }]} placeholder={t('groupNamePlaceholder')} placeholderTextColor="#999" value={sessionNameInput} onChangeText={setSessionNameInput} maxLength={15} />
            <View style={{ flexDirection: 'row', gap: 15 }}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#ccc', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={() => setIsAddSessionModal(false)}><Text>{t('cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#34A853', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={addNewSession}><Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('add')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ==========================================
// 🏆 리그전 및 매치 카드
// ==========================================
const LeagueMatchCard = React.memo(({ matchInfo, idx, updateScore, isColorMode }) => {
  const { t } = useContext(TranslationContext);
  const [localS1, setLocalS1] = useState(matchInfo.s1);
  const [localS2, setLocalS2] = useState(matchInfo.s2);
  const timerRef = useRef(null); 
  
  useEffect(() => { 
    setLocalS1(matchInfo.s1); setLocalS2(matchInfo.s2);
  }, [matchInfo.s1, matchInfo.s2]);

  const handleTextChange = (v1, v2) => {
    setLocalS1(v1); setLocalS2(v2);
    if(timerRef.current) clearTimeout(timerRef.current);
    
    timerRef.current = setTimeout(() => {
      let finalS1 = v1 === '' && v2 !== '' ? '0' : v1;
      let finalS2 = v2 === '' && v1 !== '' ? '0' : v2;
      updateScore(matchInfo.id, finalS1, finalS2);
    }, 300);
  };
  
  return (
    <View style={styles.leagueMatchCard}>
      <Text style={styles.matchInfo}>{t('matchNumber', { num: idx + 1, ref: matchInfo.referee })}</Text>
      <View style={styles.scoreRow}>
        <Text style={[styles.leagueMatchPlayer, {color: getColorForPlayer(matchInfo.p1, isColorMode)}]}>{matchInfo.p1}</Text>
        <TextInput 
          style={styles.scoreInput} keyboardType="numeric" maxLength={3} placeholder="0" placeholderTextColor="#ccc" 
          value={localS1} 
          onChangeText={(v) => handleTextChange(v.replace(/[^0-9]/g, ''), localS2)}
        />
        <Text> : </Text>
        <TextInput 
          style={styles.scoreInput} keyboardType="numeric" maxLength={3} placeholder="0" placeholderTextColor="#ccc" 
          value={localS2} 
          onChangeText={(v) => handleTextChange(localS1, v.replace(/[^0-9]/g, ''))}
        />
        <Text style={[styles.leagueMatchPlayer, {color: getColorForPlayer(matchInfo.p2, isColorMode)}]}>{matchInfo.p2}</Text>
      </View>
    </View>
  );
});

function LeagueScreen({ setScreen, globalPlayers }) {
  const { t } = useContext(TranslationContext);
  
  const [sessions, setSessions] = useState([]);
  const [activeSessionId, setActiveSessionId] = useState(null);
  const [isMatchActive, setIsMatchActive] = useState(false);
  const [clubFilter, setClubFilter] = useState(null); 
  const [rankingSystem, setRankingSystem] = useState('points');
  
  const [scoreSort, setScoreSort] = useState('default'); 
  const [isColorMode, setIsColorMode] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState('');
  const [isAddSessionModal, setIsAddSessionModal] = useState(false);
  
  const [isSummaryModal, setIsSummaryModal] = useState(false);
  const [isLeagueSaveModal, setIsLeagueSaveModal] = useState(false);

  const [isTieBreakerModal, setIsTieBreakerModal] = useState(false);

  const [savedTemplates, setSavedTemplates] = useState([]);

  const isLoadedRef = useRef(false);
  const debounceTimerRef = useRef(null);
  
  const gridCaptureRef = useRef();
  const standingsCaptureRef = useRef();
  const printableScorecardsRef = useRef();
  const summaryCaptureRef = useRef();

  useEffect(() => { setClubFilter(null); }, []);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [[, sessionsData], [, rankSysVal], [, templatesVal]] = await AsyncStorage.multiGet([KEYS.L_SESSIONS, KEYS.L_RANK_SYS, KEYS.L_TEMPLATES]);
        if (rankSysVal) setRankingSystem(rankSysVal);
        if (templatesVal) setSavedTemplates(JSON.parse(templatesVal) || []);
        
        let loadedSessions = [];
        if (sessionsData) { loadedSessions = JSON.parse(sessionsData) || []; }
        
        if (loadedSessions.length > 0) {
           setSessions(loadedSessions);
           setActiveSessionId(loadedSessions[0].id);
        } else {
           const initSession = { id: Date.now().toString(), name: '1조', players: [], matches: [], tieBreakers: {} };
           setSessions([initSession]);
           setActiveSessionId(initSession.id);
        }
        isLoadedRef.current = true;
      } catch (error) { isLoadedRef.current = true; }
    };
    loadData();
  }, []);

  useEffect(() => {
    if (!isLoadedRef.current || sessions.length === 0) return;
    debounceTimerRef.current = setTimeout(() => { 
      AsyncStorage.setItem(KEYS.L_SESSIONS, JSON.stringify(sessions)).catch(() => {}); 
    }, 500);
    return () => clearTimeout(debounceTimerRef.current);
  }, [sessions]);

  const activeSession = sessions.find(s => s.id === activeSessionId) || sessions[0];
  const leaguePlayers = activeSession?.players || [];
  const matches = activeSession?.matches || [];
  const tieBreakers = activeSession?.tieBreakers || {}; 

  const clubs = useMemo(() => {
    const set = new Set(globalPlayers.map(p => p.club || DEFAULT_CLUB_KEY));
    return [...set].sort();
  }, [globalPlayers]);

  const availablePlayers = useMemo(() => {
    const allAssignedNormals = sessions.flatMap(s => s.players).map(normalizeName);
    const filteredObjs = globalPlayers
      .filter(p => !allAssignedNormals.includes(normalizeName(p.name)))
      .filter(p => !clubFilter || p.club === clubFilter);
    return sortPlayers(filteredObjs).map(p => p.name);
  }, [globalPlayers, sessions, clubFilter]);

  const addPlayer = (name) => { 
    setSessions(prev => prev.map(s => {
      if (s.id !== activeSessionId) return s;
      if (s.players.includes(name)) return s;
      const newPlayers = [...s.players, name];
      const sorted = sortPlayers(
        newPlayers.map(n => globalPlayers.find(p => p.name === n) || { name: n, club: DEFAULT_CLUB_KEY })
      ).map(p => p.name);
      return { ...s, players: sorted };
    }));
  };

  const removePlayer = (name) => {
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) {
        return { ...s, players: s.players.filter(p => p !== name), matches: [] };
      }
      return s;
    }));
  };

  const addNewSession = () => {
    const sName = sessionNameInput.trim() || `${sessions.length + 1}조`;
    const newS = { id: Date.now().toString(), name: sName, players: [], matches: [], tieBreakers: {} };
    const updated = [...sessions, newS];
    setSessions(updated);
    setActiveSessionId(newS.id);
    setIsAddSessionModal(false);
    setSessionNameInput('');
  };

  const deleteActiveSession = () => {
    if (sessions.length <= 1) { Alert.alert(t('error'), '최소 1개의 조는 있어야 합니다.'); return; }
    Alert.alert(t('delGroup'), `'${activeSession.name}'를 삭제하시겠습니까?`, [
      { text: t('cancel'), style: 'cancel' },
      { text: t('delete'), style: 'destructive', onPress: () => {
          const updated = sessions.filter(s => s.id !== activeSessionId);
          setSessions(updated);
          setActiveSessionId(updated[0].id);
      }}
    ]);
  };

  const createMatches = async () => { 
    let n = leaguePlayers.length; let playersList = [...leaguePlayers];
    if (n % 2 !== 0) { playersList.push("DUMMY"); n += 1; }
    let rounds = []; let fixed = playersList[0], rotating = playersList.slice(1);
    for (let r = 0; r < n - 1; r++) {
      let roundMatches = [];
      if (fixed !== "DUMMY" && rotating[rotating.length - 1] !== "DUMMY") roundMatches.push({ p1: fixed, p2: rotating[rotating.length - 1] });
      for (let i = 0; i < (n - 2) / 2; i++) {
        let p1 = rotating[i], p2 = rotating[rotating.length - 2 - i];
        if (p1 !== "DUMMY" && p2 !== "DUMMY") roundMatches.push({ p1, p2 });
      }
      rounds.push(roundMatches); rotating.unshift(rotating.pop());
    }
    let tempMatches = rounds.flat(), finalMatches = [], lastMatchPlayers = [];
    while (tempMatches.length > 0) {
      let foundIndex = tempMatches.findIndex(m => !lastMatchPlayers.includes(m.p1) && !lastMatchPlayers.includes(m.p2));
      let match = foundIndex !== -1 ? tempMatches.splice(foundIndex, 1)[0] : tempMatches.splice(0, 1)[0];
      finalMatches.push(match); lastMatchPlayers = [match.p1, match.p2];
    }
    let refCounts = {}; leaguePlayers.forEach(p => refCounts[p] = 0);
    const baseTime = Date.now(); 
    let scheduleWithRefs = finalMatches.map((match, idx) => {
      let possibleRefs = leaguePlayers.filter(p => p !== match.p1 && p !== match.p2);
      possibleRefs = shuffleArray(possibleRefs); possibleRefs.sort((a, b) => refCounts[a] - refCounts[b]);
      const bestRef = possibleRefs[0]; refCounts[bestRef] += 1;
      return { id: `LM-${baseTime}-${idx}`, orgIdx: idx, ...match, referee: bestRef, s1: '', s2: '', completed: false };
    });
    
    setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, matches: scheduleWithRefs, tieBreakers: {} } : s));
    setIsMatchActive(true); 
  };

  const generateSchedule = () => {
    if (leaguePlayers.length < 3) { Alert.alert(t('notice'), t('minPlayersReq')); return; }
    if (leaguePlayers.length > 20) { Alert.alert(t('error'), t('leagueMaxError')); return; }
    if (matches.length > 0 && matches.some(m => m.completed)) {
      Alert.alert(t('matchWarningTitle'), t('matchWarningDesc'), [{ text: t('cancel'), style: 'cancel' }, { text: t('apply'), style:'destructive', onPress: () => createMatches() }]); 
      return;
    }
    createMatches();
  };

  const resetMatches = () => {
    Alert.alert(t('resetAlertTitle'), t('resetAlertDesc'), [{ text: t('cancel'), style: "cancel" }, { text: t('apply'), style: 'destructive', onPress: () => { 
        setSessions(prev => prev.map(s => s.id === activeSessionId ? { ...s, matches: [], tieBreakers: {} } : s));
    }}]);
  };

  const matchMap = useMemo(() => { const map = {}; matches.forEach(m => { map[getMatchKey(m.p1, m.p2)] = m; }); return map; }, [matches]);

  const standings = useMemo(() => calculateStandingsData(leaguePlayers, matches, rankingSystem, matchMap, tieBreakers), [leaguePlayers, matches, rankingSystem, matchMap, tieBreakers]);

  const hasTies = useMemo(() => standings.some((s, i, arr) => i > 0 && s.rank === arr[i-1].rank), [standings]);

  const updateScore = useCallback((mId, s1, s2) => {
    setSessions(prev => {
      const updated = prev.map(session => {
        if (session.id === activeSessionId) {
          const newMatches = session.matches.map(m => {
            if (m.id === mId) { return { ...m, s1, s2, completed: (s1 !== '' || s2 !== '') }; }
            return m;
          });
          return { ...session, matches: newMatches };
        }
        return session;
      });
      return updated;
    });
  }, [activeSessionId]);

  const updateTieBreaker = (playerName, priorityValue) => {
    setSessions(prev => prev.map(s => {
      if(s.id === activeSessionId) {
         return { ...s, tieBreakers: { ...s.tieBreakers, [playerName]: parseInt(priorityValue) || 0 } }
      }
      return s;
    }));
  }

  const displayedMatches = useMemo(() => {
    let list = [...matches];
    if (scoreSort === 'name') { list.sort((a,b) => a.p1.localeCompare(b.p1)); } 
    else if (scoreSort === 'class') { list.sort((a,b) => extractNumber(a.p1) - extractNumber(b.p1)); } 
    else { list.sort((a,b) => a.orgIdx - b.orgIdx); }
    return list;
  }, [matches, scoreSort]);

  const playerIndexMap = useMemo(() => {
    const map = {}; leaguePlayers.forEach((p, idx) => map[p] = idx + 1); return map;
  }, [leaguePlayers]);

  const matchSequenceText = useMemo(() => {
    return [...matches].sort((a,b)=>a.orgIdx - b.orgIdx).map(m => `${playerIndexMap[m.p1]}-${playerIndexMap[m.p2]}`).join(', ');
  }, [matches, playerIndexMap]);

  const captureAndSaveImage = async (targetRef) => {
    try {
      if (!targetRef.current) return;
      Keyboard.dismiss(); 
      const localUri = await captureRef(targetRef, { format: 'png', quality: 0.8 });
 
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = localUri;
        link.download = `탁구대회_결과_${Date.now()}.png`; 
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      } else {
        const { status } = await MediaLibrary.requestPermissionsAsync(true);
        if (status !== 'granted') { Alert.alert(t('needPermission'), t('permissionDesc')); return; }
        await MediaLibrary.saveToLibraryAsync(localUri);
        Alert.alert(t('saveSuccess'), t('saveImageSuccess'));
      }
    } catch (error) { 
      Alert.alert(t('error'), t('saveFailed')); 
    }
  };

  const handlePrint = () => {
    Keyboard.dismiss();
    if (Platform.OS === 'web') {
      window.print(); 
    } else {
      Alert.alert("알림", "PC 환경에서만 인쇄 기능이 지원됩니다.");
    }
  };

  const handleSaveProgress = () => {
    Keyboard.dismiss();
    AsyncStorage.setItem(KEYS.L_SESSIONS, JSON.stringify(sessions)).then(() => {
      Alert.alert(t('notice'), t('saveProgressMsg'));
    });
  };

  const shareStandings = () => {
    if (leaguePlayers.length === 0) return;
    const mappedText = standings.map((s) => t('leagueRankLine', { rank: s.rank, name: s.name, win: s.win, lose: s.lose, pts: s.scoreSum })).join('\n');
    const msg = t('leagueResultText', { groupName: activeSession?.name || '', text: mappedText });
    
    if (Platform.OS === 'web' && !navigator.share) {
      navigator.clipboard.writeText(msg);
      Alert.alert("알림", "결과가 클립보드에 복사되었습니다. (Ctrl+V로 붙여넣으세요)");
    } else {
      Share.share({ message: msg });
    }
  };

  const saveTemplate = async () => {
    if (leaguePlayers.length === 0) { Alert.alert(t('notice'), t('saveListEmpty')); return; }
    if (savedTemplates.length >= 10) { Alert.alert(t('warning'), t('saveListMax')); return; }
    const newTemplate = { id: Date.now().toString(), players: [...leaguePlayers] };
    const updated = [...savedTemplates, newTemplate];
    setSavedTemplates(updated);
    try { await AsyncStorage.setItem(KEYS.L_TEMPLATES, JSON.stringify(updated)); } catch(e){}
    Alert.alert(t('saveSuccess'), t('saveListSuccess'));
  };

  const loadTemplate = (players) => {
    const sorted = sortPlayers(
      players.map(n => globalPlayers.find(p => p.name === n) || { name: n, club: DEFAULT_CLUB_KEY })
    ).map(p => p.name);
    
    setSessions(prev => prev.map(s => {
      if (s.id === activeSessionId) return { ...s, players: sorted, matches: [] };
      return s;
    }));
    Alert.alert(t('notice'), t('loadGroupSuccess'));
  };

  const deleteTemplate = async (id) => {
    const updated = savedTemplates.filter(t => t.id !== id);
    setSavedTemplates(updated);
    try { await AsyncStorage.setItem(KEYS.L_TEMPLATES, JSON.stringify(updated)); } catch(e){}
  };

  const renderGridBoard = useMemo(() => {
    const statsMap = {}; standings.forEach(s => { statsMap[s.name] = s; });
    return (
      <View style={styles.gridContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View ref={gridCaptureRef} collapsable={false} style={{ backgroundColor: '#fcfcfc', paddingHorizontal: 5, paddingVertical: 15 }}>
            <Text style={[styles.captureTitle, { marginBottom: 20 }]}>{t('leagueBoardTitle', { groupName: activeSession?.name || '' })}</Text>
            <View>
              <View style={styles.row}>
                <View style={[styles.cell, styles.headerCell]}><Text style={styles.headerText}>{t('player')}</Text></View>
                {leaguePlayers.map((p, i) => (<View key={`h-${p}`} style={[styles.cell, styles.headerCell]}><Text style={[styles.headerText, {color: getColorForPlayer(p, isColorMode)}]}>{i+1}. {p}</Text></View>))}
                <View style={[styles.cell, styles.headerCell, { width: 50, backgroundColor: '#eef2f6' }]}><Text style={[styles.headerText, { color: '#1A73E8' }]}>{t('totalPoints')}</Text></View>
              </View>
              {leaguePlayers.map((rowPlayer, r) => {
                const playerStats = statsMap[rowPlayer]; const totalScore = playerStats ? playerStats.scoreSum : 0;
                return (
                  <View key={`r-${r}`} style={styles.row}>
                    <View style={[styles.cell, styles.labelCell]}><Text style={[styles.labelText, {color: getColorForPlayer(rowPlayer, isColorMode)}]}>{r+1}. {rowPlayer}</Text></View>
                    {leaguePlayers.map((colPlayer, c) => {
                      const match = matchMap[getMatchKey(rowPlayer, colPlayer)]; const isSelf = rowPlayer === colPlayer;
                      let displayScore = ''; if (!isSelf && match?.completed) { displayScore = match.p1 === rowPlayer ? (match.s1 || '0') : (match.s2 || '0'); }
                      return (
                        <View key={`c-${c}`} style={[styles.cell, isSelf && {backgroundColor: '#eee'}]}>
                          {!isSelf && match?.completed && ( <Text style={styles.gridScore}>{displayScore}</Text> )}
                        </View>
                      );
                    })}
                    <View style={[styles.cell, { width: 50, backgroundColor: '#f8f9fa' }]}><Text style={[styles.gridScore, { color: '#333' }]}>{totalScore}</Text></View>
                  </View>
                );
              })}
            </View>
            <Text style={{marginTop: 15, fontSize: 11, color: '#666'}}><Text style={{fontWeight:'bold'}}>{t('matchOrder')}:</Text> {matchSequenceText}</Text>
          </View>
        </ScrollView>
      </View>
    );
  }, [leaguePlayers, matchMap, standings, t, isColorMode, matchSequenceText, activeSession?.name]); 

  if (isMatchActive && matches.length > 0) {
    return (
      <View style={styles.screenContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setIsMatchActive(false)}><Text style={styles.backBtn}>{t('backToSetup')}</Text></TouchableOpacity>
          <Text style={styles.headerTitle}>{t('prelimBoard', { groupName: activeSession?.name || '' })}</Text>
          <TouchableOpacity onPress={handleSaveProgress}><Text style={[styles.backBtn, {color: '#34A853'}]}>{t('saveProgress')}</Text></TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={{paddingBottom: 200}} keyboardShouldPersistTaps="handled">
          <View style={{ paddingTop: 20 }}>
            {renderGridBoard}
            <View ref={standingsCaptureRef} collapsable={false} style={[styles.rankSection, { backgroundColor: '#fcfcfc' }]}>
              
              <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center'}}>
                <Text style={styles.sectionTitle}>{t('detailedStandings')}</Text>
                {hasTies && (
                  <TouchableOpacity style={styles.summaryBtn} onPress={() => setIsTieBreakerModal(true)}>
                    <Text style={styles.summaryBtnText}>🏆 동률 순위 결정</Text>
                  </TouchableOpacity>
                )}
              </View>
              {hasTies && <Text style={{fontSize: 12, color: '#EA4335', marginBottom: 10}}>※ 토너먼트 자동 연동을 위해 순위가 같은 그룹의 [내부 순위]를 정해주세요.</Text>}

              <View style={[styles.rankRow, { borderBottomWidth: 1, borderColor: '#aaa', paddingBottom: 5 }]}>
                <Text style={{width: 40, fontSize: 12, color: '#666', fontWeight: 'bold'}}>{t('rank')}</Text>
                <Text style={{flex: 1, fontSize: 12, color: '#666', fontWeight: 'bold'}}>{t('name')}</Text>
                <Text style={{width: 60, fontSize: 12, color: '#666', fontWeight: 'bold', textAlign: 'center'}}>{t('winLoss')}</Text>
                <Text style={{width: 60, fontSize: 12, color: '#666', fontWeight: 'bold', textAlign: 'right'}}>{t('totalPoints')}</Text>
              </View>
              {standings.map((s, i) => {
                const isTied = i > 0 && standings[i - 1].rank === s.rank || (i < standings.length-1 && standings[i + 1].rank === s.rank);
                return (
                  <View key={`rank-${s.name}`} style={[styles.rankRow, isTied && { backgroundColor: '#FFF9C4' }]}>
                    <Text style={{width: 40}}>{s.rank} {isTied && <Text style={{color: '#EA4335', fontSize: 10}}>(내부 {s.internalRank})</Text>}</Text>
                    <Text style={{flex: 1, fontWeight: 'bold', color: getColorForPlayer(s.name, isColorMode)}}>{s.name}</Text>
                    <Text style={{width: 60, textAlign: 'center'}}>{t('winLossFormat', { win: s.win, lose: s.lose })}</Text>
                    <Text style={{width: 60, textAlign: 'right', color: '#1A73E8', fontWeight: 'bold'}}>{s.scoreSum}</Text>
                  </View>
                );
              })}
            </View>
          </View> 

          <View style={{ paddingHorizontal: 15, marginTop: 10 }}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10}}>
              <Text style={styles.sectionTitle}>{t('scoreBoard')}</Text>
              <View style={{flexDirection: 'row', alignItems: 'center'}}>
                <TouchableOpacity onPress={() => setIsColorMode(!isColorMode)} style={[styles.sortBtn, isColorMode && {backgroundColor:'#eef2f6', borderColor:'#1A73E8'} ]}><Text style={[styles.sortBtnText, isColorMode && {color:'#1A73E8'}]}>{t('colorMode')}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setScoreSort('default')} style={[styles.sortBtn, scoreSort === 'default' && {backgroundColor:'#333'}]}><Text style={[styles.sortBtnText, scoreSort === 'default' && {color:'#fff'}]}>{t('sortDefault')}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setScoreSort('name')} style={[styles.sortBtn, scoreSort === 'name' && {backgroundColor:'#333'}]}><Text style={[styles.sortBtnText, scoreSort === 'name' && {color:'#fff'}]}>{t('sortName')}</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setScoreSort('class')} style={[styles.sortBtn, scoreSort === 'class' && {backgroundColor:'#333'}]}><Text style={[styles.sortBtnText, scoreSort === 'class' && {color:'#fff'}]}>{t('sortClass')}</Text></TouchableOpacity>
              </View>
            </View>
          </View>

          <View style={{backgroundColor:'#fcfcfc', paddingVertical: 10}}>
             {displayedMatches.map(m => ( <LeagueMatchCard key={m.id} matchInfo={m} idx={m.orgIdx} updateScore={updateScore} isColorMode={isColorMode} /> ))}
          </View>
          
          <View style={{marginTop: 20}}>
            <View style={styles.leagueActionRow}>
              <TouchableOpacity style={[styles.actionBtnShare, { backgroundColor: '#5F6368' }]} onPress={handlePrint}>
                <Text style={styles.actionBtnText}>🖨️ 결과 인쇄하기</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.actionBtnImage} onPress={() => setIsLeagueSaveModal(true)}>
                <Text style={styles.actionBtnText}>📸 결과 이미지로 저장</Text>
              </TouchableOpacity>
            </View>
          </View>
          
          <View style={{ height: 400 }} />
        </ScrollView>

        <Modal visible={isTieBreakerModal} transparent animationType="slide">
          <View style={styles.modalBg}>
            <View style={[styles.modalBox, {height: '70%', padding: 25}]}>
              <Text style={styles.sectionTitle}>🏆 동률 순위 수동 결정</Text>
              <Text style={{fontSize: 12, color: '#666', marginBottom: 15}}>
                순위가 동일한 선수 그룹에 대해 토너먼트 진출 시 적용될 내부 순위(우선순위) 숫자를 지정해주세요. (낮은 숫자 우선)
              </Text>
              <ScrollView style={{flex: 1}}>
                {(() => {
                  const tiedRanks = [...new Set(standings.filter((s, i, arr) => (i > 0 && s.rank === arr[i-1].rank) || (i < arr.length-1 && s.rank === arr[i+1].rank)).map(s=>s.rank))];
                  return tiedRanks.map(r => {
                     const playersInRank = standings.filter(s => s.rank === r);
                     return (
                        <View key={`tie-r-${r}`} style={{marginBottom: 20, backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8}}>
                           <Text style={{fontWeight: 'bold', color: '#1A73E8', marginBottom: 10}}>공동 {r}위 그룹</Text>
                           {playersInRank.map(p => (
                              <View key={`tie-p-${p.name}`} style={{flexDirection: 'row', alignItems: 'center', marginBottom: 8}}>
                                <Text style={{flex: 1, fontWeight: '500', color: '#333'}}>{p.name}</Text>
                                <Text style={{fontSize: 12, marginRight: 10}}>내부 순위:</Text>
                                <TextInput 
                                  style={{borderWidth: 1, borderColor: '#ccc', borderRadius: 5, width: 40, textAlign: 'center', padding: 5, backgroundColor: '#fff'}}
                                  keyboardType="numeric"
                                  value={String(tieBreakers[p.name] || '')}
                                  placeholder="0"
                                  onChangeText={(v) => updateTieBreaker(p.name, v)}
                                />
                              </View>
                           ))}
                        </View>
                     )
                  })
                })()}
              </ScrollView>
              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#1A73E8', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 15}]} onPress={() => setIsTieBreakerModal(false)}>
                <Text style={{color: '#fff', fontWeight: 'bold'}}>확인 및 적용</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <Modal visible={isLeagueSaveModal} transparent animationType="fade">
          <View style={styles.modalBg}>
            <View style={styles.modalBox}>
              <Text style={styles.sectionTitle}>{t('selectSaveOption')}</Text>
              <TouchableOpacity style={styles.exportListItem} onPress={() => { captureAndSaveImage(gridCaptureRef); setIsLeagueSaveModal(false); }}>
                <Text style={styles.exportListText}>📊 {t('saveGrid')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportListItem} onPress={() => { captureAndSaveImage(standingsCaptureRef); setIsLeagueSaveModal(false); }}>
                <Text style={styles.exportListText}>🏆 {t('saveStandings')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.exportListItem} onPress={() => { captureAndSaveImage(printableScorecardsRef); setIsLeagueSaveModal(false); }}>
                <Text style={styles.exportListText}>🖨️ {t('savePrintableScorecards')}</Text>
              </TouchableOpacity>
              
              <Text style={{fontSize: 12, color: '#EA4335', marginTop: 15, textAlign: 'center'}}>
                ※ 모바일 웹 브라우저 캡처 시 화면이 잘릴 수 있습니다. 가급적 [결과 인쇄하기(PDF)]를 권장합니다.
              </Text>

              <TouchableOpacity style={[styles.actionBtn, {backgroundColor:'#ccc', padding: 12, borderRadius: 8, alignItems: 'center', marginTop: 15}]} onPress={() => setIsLeagueSaveModal(false)}>
                <Text>{t('cancel')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>

        <View style={{ position: 'absolute', top: -10000, left: 0, opacity: 0 }}>
          <View ref={printableScorecardsRef} collapsable={false} style={{ width: 800, backgroundColor: '#fff', padding: 20 }}>
            <Text style={{ fontSize: 24, fontWeight: 'bold', textAlign: 'center', marginBottom: 30 }}>{t('matchScorecardTitle', { groupName: activeSession?.name })}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' }}>
              {displayedMatches.map((m, i) => (
                <View key={`print-${m.id}`} style={{ width: '48%', borderWidth: 2, borderColor: '#000', marginBottom: 20, padding: 15, borderRadius: 10 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', borderBottomWidth: 1, borderColor: '#ccc', paddingBottom: 10, marginBottom: 15 }}>
                    <Text style={{ fontSize: 18, fontWeight: 'bold' }}>Match {i+1}</Text>
                    <Text style={{ fontSize: 16 }}>{t('matchRefAndTable', { ref: m.referee || '         ' })}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', marginBottom: 20 }}>
                    <Text style={{ fontSize: 22, fontWeight: 'bold', flex: 1, textAlign: 'center', color: '#000' }}>{m.p1}</Text>
                    <Text style={{ fontSize: 16, color: '#666', marginHorizontal: 10 }}>VS</Text>
                    <Text style={{ fontSize: 22, fontWeight: 'bold', flex: 1, textAlign: 'center', color: '#000' }}>{m.p2}</Text>
                  </View>
                  {[1,2,3,4,5].map(g => (
                    <View key={`g-${g}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                      <Text style={{ width: 60, fontSize: 16, fontWeight: '500', color: '#555' }}>{t('gameNum', { num: g })}</Text>
                      <View style={{ width: 60, height: 35, borderWidth: 1, borderColor: '#aaa', borderRadius: 5 }} />
                      <Text style={{ marginHorizontal: 15, fontSize: 18 }}> : </Text>
                      <View style={{ width: 60, height: 35, borderWidth: 1, borderColor: '#aaa', borderRadius: 5 }} />
                    </View>
                  ))}
                  <View style={{ borderTopWidth: 2, borderColor: '#000', paddingTop: 15, marginTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}>
                    <Text style={{ fontWeight: 'bold', marginRight: 15, fontSize: 16 }}>{t('finalScore')}</Text>
                    <View style={{ width: 50, height: 35, borderWidth: 3, borderColor: '#000', borderRadius: 5 }} />
                    <Text style={{ marginHorizontal: 10, fontSize: 18 }}>:</Text>
                    <View style={{ width: 50, height: 35, borderWidth: 3, borderColor: '#000', borderRadius: 5 }} />
                  </View>
                  <View style={{ marginTop: 15, alignItems: 'center' }}>
                    <Text style={{ fontWeight: 'bold', fontSize: 16 }}>{t('finalWinner')}</Text>
                  </View>
                </View>
              ))}
            </View>
          </View>
        </View>

      </View>
    );
  }

  return (
    <View style={styles.screenContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => setScreen('Home')}><Text style={styles.backBtn}>{t('backToMain')}</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>{t('prelimSetup')}</Text>
        <View style={{width: 50}} />
      </View>

      <View style={styles.sessionTabContainer}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{alignItems: 'center', paddingHorizontal: 15}}>
          {sessions.map(s => (
            <TouchableOpacity key={s.id} style={[styles.sessionTab, activeSessionId === s.id && styles.sessionTabActive]} onPress={() => setActiveSessionId(s.id)}>
              <Text style={[styles.sessionTabText, activeSessionId === s.id && styles.sessionTabTextActive]}>{s.name}</Text>
            </TouchableOpacity>
          ))}
          <TouchableOpacity style={styles.sessionTabAdd} onPress={() => setIsAddSessionModal(true)}>
            <Text style={styles.sessionTabAddText}>{t('addGroup')}</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.summaryBtn} onPress={() => setIsSummaryModal(true)}>
            <Text style={styles.summaryBtnText}>{t('summaryBtn')}</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <ScrollView contentContainerStyle={{paddingBottom: 50}} keyboardShouldPersistTaps="handled">
        <View style={styles.leagueSection}>
          <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
            <Text style={[styles.sectionTitle, {marginBottom: 0}]}>📌 [{activeSession?.name}] 명단 설정</Text>
            <TouchableOpacity onPress={deleteActiveSession}><Text style={{color: '#EA4335', fontSize: 12, fontWeight: 'bold'}}>{t('delGroup')}</Text></TouchableOpacity>
          </View>

          <Text style={[styles.sectionTitle, {marginTop: 15}]}>{t('loadFromDb')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{marginBottom: 10, maxHeight: 50}} contentContainerStyle={{alignItems: 'center'}}>
            <TouchableOpacity style={[styles.clubTab, !clubFilter && styles.clubTabActive]} onPress={() => setClubFilter(null)}><Text style={[styles.clubTabText, !clubFilter && styles.clubTabTextActive]}>{t('all')}</Text></TouchableOpacity>
            {clubs.map(c => (
              <TouchableOpacity key={c} style={[styles.clubTab, clubFilter === c && styles.clubTabActive]} onPress={() => setClubFilter(c)}><Text style={[styles.clubTabText, clubFilter === c && styles.clubTabTextActive]}>{getDisplayClubName(c, t)}</Text></TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={styles.infoText}>{t('swipeInstruction')}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 15, paddingBottom: 5 }} keyboardShouldPersistTaps="handled">
            {availablePlayers.length === 0 ? <Text style={{color:'#999', marginVertical: 10, marginHorizontal: 5}}>{t('noAvailablePlayers')}</Text> : null}
            {availablePlayers.map(pName => ( <TouchableOpacity key={`avail-${pName}`} style={[styles.inactiveTag, { marginBottom: 0 }]} onPress={() => addPlayer(pName)}><Text style={{color: '#555'}}>{pName} +</Text></TouchableOpacity> ))}
          </ScrollView>

          <Text style={[styles.sectionTitle, {marginTop: 10}]}>{t('confirmedPlayers', { groupName: activeSession?.name || '', count: leaguePlayers.length })}</Text>
          <View style={[styles.tagWrap, {minHeight: 50, padding: 10, backgroundColor: '#f9f9f9', borderRadius: 8}]}>
            {leaguePlayers.length === 0 ? <Text style={{color:'#999'}}>{t('noSelectedPlayers')}</Text> : null}
            {leaguePlayers.map(p => ( <TouchableOpacity key={`selected-${p}`} style={styles.tag} onPress={() => removePlayer(p)}><Text>{p} ✕</Text></TouchableOpacity> ))}
          </View>

          {matches.length > 0 ? (
            <View style={{flexDirection: 'row', marginTop: 20, gap: 10}}>
              <TouchableOpacity style={[styles.genBtn, {flex: 1, backgroundColor: '#34A853'}]} onPress={() => setIsMatchActive(true)}>
                <Text style={styles.genBtnText}>{t('enterBoardBtn', { groupName: activeSession?.name || '' })}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.genBtn, {backgroundColor: '#EA4335'}]} onPress={resetMatches}>
                <Text style={styles.genBtnText}>{t('resetBoardBtn')}</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={[styles.genBtn, {marginTop: 20}]} onPress={generateSchedule}>
              <Text style={styles.genBtnText}>{t('genMatchesBtn')}</Text>
            </TouchableOpacity>
          )}
          
          <Text style={[styles.sectionTitle, {marginTop: 30}]}>{t('rankingMethodTitle')}</Text>
          <View style={styles.radioGroup}>
            <TouchableOpacity style={[styles.radioBtn, rankingSystem === 'points' && styles.radioBtnActive]} onPress={() => { setRankingSystem('points'); AsyncStorage.setItem(KEYS.L_RANK_SYS, 'points').catch(()=>{}); }}><Text style={[styles.radioText, rankingSystem === 'points' && styles.radioTextActive]}>{t('rankPoints')}</Text></TouchableOpacity>
            <TouchableOpacity style={[styles.radioBtn, rankingSystem === 'wins' && styles.radioBtnActive]} onPress={() => { setRankingSystem('wins'); AsyncStorage.setItem(KEYS.L_RANK_SYS, 'wins').catch(()=>{}); }}><Text style={[styles.radioText, rankingSystem === 'wins' && styles.radioTextActive]}>{t('rankWins')}</Text></TouchableOpacity>
          </View>
          
          <View style={{marginTop: 30, borderTopWidth: 1, borderColor: '#eee', paddingTop: 20}}>
            <View style={{flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 15}}>
              <Text style={styles.sectionTitle}>{t('savedGroupsInfo')}</Text>
              <TouchableOpacity style={styles.saveGroupBtn} onPress={saveTemplate}><Text style={styles.saveGroupBtnText}>{t('saveCurrentList')}</Text></TouchableOpacity>
            </View>
            {savedTemplates.length === 0 ? ( <Text style={{color: '#999', textAlign: 'center', padding: 10}}>{t('noSavedGroups')}</Text> ) : (
              savedTemplates.map((template, index) => (
                <View key={template.id} style={styles.groupRow}>
                  <Text style={styles.groupName}>{t('template', { index: index + 1 })}</Text>
                  <Text style={styles.groupPlayers} numberOfLines={2}>{template.players.join(', ')}</Text>
                  <View style={styles.groupActionBtnWrap}>
                    <TouchableOpacity style={styles.groupLoadBtn} onPress={() => loadTemplate(template.players)}><Text style={styles.groupActionText}>{t('load')}</Text></TouchableOpacity>
                    <TouchableOpacity style={styles.groupDelBtn} onPress={() => deleteTemplate(template.id)}><Text style={styles.groupActionText}>{t('delete')}</Text></TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      </ScrollView>

      <Modal visible={isAddSessionModal} transparent animationType="fade">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, {padding: 30}]}>
            <Text style={styles.sectionTitle}>{t('groupNameInputTitle')}</Text>
            <TextInput style={[styles.input, { flex: 0, width: '100%', marginBottom: 25, fontSize: 16 }]} placeholder={t('groupNamePlaceholder')} placeholderTextColor="#999" value={sessionNameInput} onChangeText={setSessionNameInput} maxLength={15} />
            <View style={{ flexDirection: 'row', gap: 15 }}>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#ccc', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={() => setIsAddSessionModal(false)}><Text>{t('cancel')}</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.actionBtn, { backgroundColor: '#34A853', padding: 12, borderRadius: 8, flex: 1, alignItems: 'center' }]} onPress={addNewSession}><Text style={{ color: '#fff', fontWeight: 'bold' }}>{t('add')}</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={isSummaryModal} transparent animationType="slide">
        <View style={styles.modalBg}>
          <View style={[styles.modalBox, {height: '80%', padding: 0}]}>
            <View style={{backgroundColor: '#1A73E8', padding: 20, borderTopLeftRadius: 15, borderTopRightRadius: 15}}>
              <Text style={{color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center'}}>{t('summaryTitle')}</Text>
            </View>
            
            <ScrollView style={{flex: 1}}>
              <View ref={summaryCaptureRef} collapsable={false} style={{padding: 20, backgroundColor: '#fff'}}>
                {sessions.map(s => {
                  const sMap = {};
                  s.matches.forEach(m => { sMap[getMatchKey(m.p1, m.p2)] = m; });
                  const st = calculateStandingsData(s.players, s.matches, rankingSystem, sMap, s.tieBreakers || {});
                  const hasMatches = s.matches.length > 0;
                  
                  return (
                    <View key={`sum-${s.id}`} style={{marginBottom: 25, backgroundColor: '#f9f9f9', borderRadius: 10, padding: 15, borderWidth: 1, borderColor: '#eee'}}>
                      <Text style={{fontSize: 16, fontWeight: 'bold', color: '#1A73E8', marginBottom: 10}}>📌 {s.name}</Text>
                      {!hasMatches ? <Text style={{color: '#999', fontSize: 13}}>{t('noDataGroup')}</Text> : (
                        st.slice(0, 3).map((playerStat, i) => ( 
                          <View key={`sum-p-${playerStat.name}`} style={{flexDirection: 'row', alignItems: 'center', marginBottom: 5}}>
                            <Text style={{width: 35, fontWeight: 'bold', color: i===0?'#FBC02D':i===1?'#9E9E9E':'#795548'}}>{playerStat.rank}위</Text>
                            <Text style={{flex: 1, fontWeight: '600', color: '#333'}}>{playerStat.name}</Text>
                            <Text style={{fontSize: 12, color: '#666'}}>{playerStat.win}승 {playerStat.lose}패 ({playerStat.scoreSum}점)</Text>
                          </View>
                        ))
                      )}
                    </View>
                  )
                })}
              </View>
            </ScrollView>

            <View style={{flexDirection: 'row', borderTopWidth: 1, borderColor: '#eee'}}>
              <TouchableOpacity 
                style={{flex: 1, padding: 15, backgroundColor: '#f0f0f0', alignItems: 'center', borderBottomLeftRadius: 15}} 
                onPress={() => setIsSummaryModal(false)}
              >
                <Text style={{fontWeight: 'bold', color: '#555'}}>{t('cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={{flex: 1, padding: 15, backgroundColor: '#1A73E8', alignItems: 'center', borderBottomRightRadius: 15}} 
                onPress={() => captureAndSaveImage(summaryCaptureRef)}
              >
                <Text style={{fontWeight: 'bold', color: '#fff'}}>{t('saveImage')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

    </View>
  );
}

// 스타일 시트 - 원본 유지
const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#fcfcfc' },
  container: { flex: 1 },
  screenContainer: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 15, borderBottomWidth: 1, borderColor: '#ddd', backgroundColor: '#fff' },
  backBtn: { fontSize: 14, color: '#1A73E8', fontWeight: 'bold' },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  homeContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  langSwitchBtn: { position: 'absolute', top: 20, right: 20, backgroundColor: '#f0f0f0', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, borderWidth: 1, borderColor: '#ddd' },
  langSwitchText: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  mainLogo: { fontSize: 60, marginBottom: 10 },
  mainTitle: { fontSize: 26, fontWeight: 'bold', marginBottom: 40, color: '#333' },
  menuBtn: { width: '100%', backgroundColor: '#34A853', padding: 20, borderRadius: 15, marginBottom: 15, elevation: 3 },
  menuBtnText: { color: '#fff', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  manualMenuBtn: { width: '100%', backgroundColor: '#f8f9fa', padding: 15, borderRadius: 15, borderWidth: 1, borderColor: '#ddd', elevation: 1 },
  manualMenuBtnText: { color: '#555', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  manualContent: { padding: 20, paddingBottom: 50 },
  manualSection: { marginBottom: 30 },
  manualSectionTitle: { fontSize: 18, fontWeight: 'bold', color: '#1A73E8', marginBottom: 15, borderBottomWidth: 2, borderColor: '#1A73E8', paddingBottom: 5 },
  manualBox: { backgroundColor: '#fff', padding: 15, borderRadius: 10, borderWidth: 1, borderColor: '#eee', elevation: 1 },
  manualText: { fontSize: 14, color: '#444', lineHeight: 22, marginBottom: 8 },
  boldText: { fontWeight: 'bold', color: '#222' },
  inputRow: { flexDirection: 'row', marginBottom: 10 },
  inputRowBox: { flexDirection: 'row', marginBottom: 10, backgroundColor: '#f5f5f5', padding: 10, borderRadius: 8 },
  input: { flex: 1, borderBottomWidth: 2, borderColor: '#1A73E8', marginRight: 10, padding: 8, fontSize: 15, color: '#333', minHeight: 45 },
  addBtn: { backgroundColor: '#1A73E8', paddingHorizontal: 15, justifyContent: 'center', borderRadius: 8 },
  addBtnText: { color: '#fff', fontWeight: 'bold' },
  importBtn: { backgroundColor: '#f0f0f0', padding: 10, borderRadius: 8, marginBottom: 15, alignItems: 'center' },
  importBtnText: { color: '#555', fontSize: 13, fontWeight: 'bold' },
  tagWrap: { flexDirection: 'row', flexWrap: 'wrap' },
  tag: { backgroundColor: '#eef2f6', padding: 10, borderRadius: 20, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#d1e3f8' },
  inactiveTag: { backgroundColor: '#fff', padding: 10, borderRadius: 20, marginRight: 8, marginBottom: 8, borderWidth: 1, borderColor: '#ccc', borderStyle: 'dashed' },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 10, color: '#1A73E8' },
  infoText: { fontSize: 13, color: '#666', marginBottom: 10 },
  radioGroup: { flexDirection: 'row', marginBottom: 15 },
  radioBtn: { flex: 1, paddingVertical: 12, borderWidth: 1, borderColor: '#ccc', alignItems: 'center', marginHorizontal: 5, borderRadius: 8, backgroundColor: '#f9f9f9' },
  radioBtnActive: { borderColor: '#1A73E8', backgroundColor: '#eef2f6' },
  radioText: { fontSize: 14, color: '#555', fontWeight: 'bold' },
  radioTextActive: { color: '#1A73E8' },
  seedRow: { marginBottom: 15, paddingBottom: 10, borderBottomWidth: 1, borderColor: '#eee' },
  seedLabel: { fontSize: 14, marginBottom: 8, color: '#333' },
  smallTag: { backgroundColor: '#f0f0f0', padding: 10, borderRadius: 20, marginRight: 8, borderWidth: 1, borderColor: '#ddd' },
  genBtn: { backgroundColor: '#1A73E8', padding: 15, borderRadius: 8, alignItems: 'center', elevation: 2 },
  genBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  modalBox: { width: '90%', backgroundColor: '#fff', padding: 25, borderRadius: 15, alignItems: 'stretch' },
  textArea: { width: '100%', height: 200, backgroundColor: '#f9f9f9', padding: 10, borderRadius: 8, textAlignVertical: 'top', borderWidth: 1, borderColor: '#eee', color: '#333' },
  winnerBtn: { backgroundColor: '#1A73E8', padding: 15, borderRadius: 10, width: '45%', alignItems: 'center' },
  winnerBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
  bracketBoard: { backgroundColor: '#ffffff', minHeight: 700, padding: 10 },
  roundColumn: { width: 140, marginRight: 35, alignItems: 'center' },
  roundTitle: { fontSize: 14, fontWeight: 'bold', color: '#1A73E8', marginBottom: 20, backgroundColor: '#eef2f6', paddingHorizontal: 15, paddingVertical: 5, borderRadius: 15 },
  matchesColumn: { flex: 1, justifyContent: 'space-around', width: '100%' },
  matchWrapper: { flexDirection: 'row', alignItems: 'center', marginVertical: 10 },
  treeMatchCard: { backgroundColor: '#fff', width: 130, borderRadius: 8, borderWidth: 1, borderColor: '#ccc', overflow: 'hidden', elevation: 2 },
  playerSlot: { paddingVertical: 8, paddingHorizontal: 5, alignItems: 'center', backgroundColor: '#fdfdfd' },
  winnerSlot: { backgroundColor: '#34A853' },
  treeDivider: { height: 1, backgroundColor: '#eee', width: '100%' },
  treePlayerText: { fontSize: 13, color: '#333' },
  connectorLine: { height: 2, width: 35, backgroundColor: '#ccc', position: 'absolute', right: -35 },
  leagueSection: { padding: 15, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  captureTitle: { fontSize: 18, fontWeight: 'bold', textAlign: 'center', marginBottom: 20, color: '#333' },
  gridContainer: { paddingHorizontal: 15 }, 
  row: { flexDirection: 'row' },
  cell: { width: 65, height: 40, borderWidth: 0.5, borderColor: '#ddd', justifyContent: 'center', alignItems: 'center' },
  headerCell: { backgroundColor: '#f8f9fa' },
  headerText: { fontSize: 10, fontWeight: 'bold', textAlign: 'center' },
  labelCell: { backgroundColor: '#f8f9fa', paddingHorizontal: 2 },
  labelText: { fontSize: 11, fontWeight: 'bold', textAlign: 'center' },
  gridScore: { fontSize: 13, fontWeight: 'bold', color: '#1A73E8' },
  rankSection: { padding: 15, marginTop: 10 },
  rankRow: { flexDirection: 'row', paddingVertical: 10, borderBottomWidth: 0.5, borderColor: '#eee', alignItems: 'center' },
  leagueMatchCard: { backgroundColor: '#fff', marginHorizontal: 15, marginBottom: 8, padding: 15, borderRadius: 10, elevation: 1, borderWidth: 1, borderColor: '#eee' },
  matchInfo: { fontSize: 12, color: '#1A73E8', marginBottom: 10 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  leagueMatchPlayer: { flex: 1, textAlign: 'center', fontWeight: '600', fontSize: 15 },
  scoreInput: { borderBottomWidth: 2, borderColor: '#1A73E8', width: 40, textAlign: 'center', fontSize: 20, color: '#333', minHeight: 45 },
  actionRow: { flexDirection: 'row', justifyContent: 'center', padding: 15, paddingBottom: Platform.OS === 'android' ? 60 : 45, backgroundColor: '#fff', borderTopWidth: 1, borderColor: '#eee' },
  leagueActionRow: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 15, marginBottom: 15 },
  actionBtnShare: { flex: 1, backgroundColor: '#FBBC04', paddingVertical: 15, borderRadius: 8, marginRight: 5, alignItems: 'center', elevation: 2 },
  actionBtnImage: { flex: 1, backgroundColor: '#34A853', paddingVertical: 15, borderRadius: 8, alignItems: 'center', elevation: 2 },
  actionBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  clubTabBar: { backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee', maxHeight: 55, minHeight: 50, flexGrow: 0, paddingVertical: 8 },
  clubTab: { paddingHorizontal: 16, paddingVertical: 8, marginRight: 8, borderRadius: 20, backgroundColor: '#f0f0f0', borderWidth: 1, borderColor: '#ddd', alignSelf: 'center' },
  clubTabActive: { backgroundColor: '#1A73E8', borderColor: '#1A73E8' },
  clubTabText: { fontSize: 13, fontWeight: 'bold', color: '#555' },
  clubTabTextActive: { color: '#fff' },
  addingToClubHint: { fontSize: 13, color: '#34A853', fontWeight: 'bold', marginBottom: 15, backgroundColor: '#EAF3DE', padding: 10, borderRadius: 8, textAlign: 'center' },
  exportListItem: { paddingVertical: 15, borderBottomWidth: 1, borderColor: '#eee' },
  exportListText: { fontSize: 16, color: '#333', fontWeight: '500' },
  sortBtn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15, borderWidth: 1, borderColor: '#ddd', marginLeft: 5 },
  sortBtnText: { fontSize: 11, color: '#555', fontWeight: 'bold' },
  playerListItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderColor: '#eee' },
  playerListName: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  playerListSub: { fontSize: 12, color: '#666', marginTop: 4 },
  playerDeleteBtn: { padding: 10, backgroundColor: '#fdeeea', borderRadius: 8 },
  sessionTabContainer: { backgroundColor: '#fff', paddingVertical: 10, borderBottomWidth: 1, borderColor: '#ddd' },
  sessionTab: { paddingVertical: 8, paddingHorizontal: 20, borderRadius: 20, backgroundColor: '#f0f0f0', marginRight: 10, borderWidth: 1, borderColor: '#ccc' },
  sessionTabActive: { backgroundColor: '#1A73E8', borderColor: '#1A73E8' },
  sessionTabText: { fontSize: 14, fontWeight: 'bold', color: '#555' },
  sessionTabTextActive: { color: '#fff' },
  sessionTabAdd: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: '#eef2f6', borderWidth: 1, borderColor: '#1A73E8', borderStyle: 'dashed', justifyContent: 'center' },
  sessionTabAddText: { color: '#1A73E8', fontWeight: 'bold', fontSize: 13 },
  summaryBtn: { paddingVertical: 8, paddingHorizontal: 15, borderRadius: 20, backgroundColor: '#FBE9E7', borderWidth: 1, borderColor: '#FF7043', marginLeft: 15, justifyContent: 'center' },
  summaryBtnText: { color: '#D84315', fontWeight: 'bold', fontSize: 13 },
  saveGroupBtn: { backgroundColor: '#1A73E8', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 20, elevation: 1 },
  saveGroupBtnText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  groupRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#f9f9f9', padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: '#eee' },
  groupName: { width: 70, fontWeight: 'bold', color: '#1A73E8', fontSize: 13 },
  groupPlayers: { flex: 1, fontSize: 12, color: '#555', paddingRight: 10 },
  groupActionBtnWrap: { flexDirection: 'row' },
  groupLoadBtn: { backgroundColor: '#34A853', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 5, marginRight: 5 },
  groupDelBtn: { backgroundColor: '#EA4335', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 5 },
  groupActionText: { color: '#fff', fontSize: 11, fontWeight: 'bold' }
});
