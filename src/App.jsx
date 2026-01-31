import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, 
  AlertCircle, Printer, History, Settings, Save, Search, 
  BookOpen, Utensils, CheckCircle2, Database, WifiOff, ExternalLink 
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * [환경 변수 로드 로직 최적화]
 * 미리보기 환경(Canvas)과 Vite/Vercel 환경에서 모두 에러가 나지 않도록 설계했습니다.
 */
const getSafeEnv = (key) => {
  // 1. 브라우저 전역 변수 확인 (Canvas/미리보기용)
  if (typeof window !== 'undefined') {
    if (window[key]) return window[key];
    if (window[`__${key.toLowerCase()}`]) return window[`__${key.toLowerCase()}`];
  }
  
  // 2. Vite/Vercel 환경 변수 확인 (import.meta 에러 방지 처리)
  try {
    const viteKey = `VITE_${key.toUpperCase()}`;
    // 직접적인 import.meta.env 호출 대신 안전한 접근 시도
    const envBase = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    return envBase[viteKey] || envBase[key] || null;
  } catch (e) {
    return null;
  }
};

// Firebase 초기 설정
const rawConfig = getSafeEnv('FIREBASE_CONFIG');
let firebaseConfig = null;
try {
  if (rawConfig) {
    firebaseConfig = typeof rawConfig === 'string' ? JSON.parse(rawConfig) : rawConfig;
  }
} catch (e) {
  console.error("Firebase 설정 파싱 실패");
}

const appId = getSafeEnv('APP_ID') || 'jihyun-meal-v4';
const initialAuthToken = getSafeEnv('INITIAL_AUTH_TOKEN');

// Firebase 서비스 초기화 (안전장치)
let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (e) {
    console.error("Firebase 초기화 에러");
  }
}

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); 
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [recipeList, setRecipeList] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });
  const [error, setError] = useState(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [currentRecipe, setCurrentRecipe] = useState(null);

  // 1. 시스템 인증 (익명 로그인)
  useEffect(() => {
    const initAuth = async () => {
      if (!auth) { setAuthLoading(false); return; }
      try {
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);
      } catch (err) {
        console.error("인증 처리 중 오류");
      } finally {
        setAuthLoading(false);
      }
    };
    initAuth();
    const unsub = auth ? onAuthStateChanged(auth, setUser) : () => {};
    return () => unsub();
  }, []);

  // 2. 실시간 데이터 로드 (히스토리, 레시피, 설정)
  useEffect(() => {
    if (!user || !db) return;

    // 식단 히스토리
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistoryList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, () => {});

    // 저장된 레시피
    const recipeRef = collection(db, 'artifacts', appId, 'public', 'data', 'recipes');
    const unsubRecipes = onSnapshot(recipeRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecipeList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, () => {});

    // 사용자 설정
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (d) => {
      if (d.exists()) setUserSettings(d.data());
    }, () => {});

    return () => { unsubHistory(); unsubRecipes(); unsubSettings(); };
  }, [user]);

  // 3. API 키 가져오기 (우선순위: 사용자 설정 > 환경 변수)
  const getApiKey = useCallback(() => {
    return userSettings.geminiKey || getSafeEnv('GEMINI_API_KEY') || "";
  }, [userSettings.geminiKey]);

  // 4. 식단 생성 로직
  const generateWeeklyPlan = async () => {
    const key = getApiKey();
    if (!key) { setError("설정 탭에서 Gemini API 키를 먼저 저장해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "병원 환자용 주간 식단표(월~일)를 짜줘." }] }],
          systemInstruction: { parts: [{ text: "전문 영양사로서 JSON {days: []} 형식으로만 답하세요. 각 날짜별로 breakfast, lunch, dinner, snack 메뉴를 포함하세요." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("식단 생성에 실패했습니다. API 키를 확인해 보세요."); } finally { setLoading(false); }
  };

  // 5. 레시피 생성 로직
  const generateRecipe = async (q) => {
    const key = getApiKey();
    if (!key || !q) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${q}의 병원식 상세 레시피를 알려줘.` }] }],
          systemInstruction: { parts: [{ text: "JSON {title, ingredients: [], steps: []} 형식으로만 답변하세요." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setCurrentRecipe(data);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'recipes'), { ...data, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("레시피 생성 실패"); } finally { setLoading(false); }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center py-2 min-h-[120px] print:min-h-0 leading-tight">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>{item}</span>
      ))}
    </div>
  );

  if (authLoading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
      <Loader2 className="animate-spin text-blue-600" size={48} />
      <p className="font-black text-slate-400 text-xs tracking-widest">SYSTEM ACCESSING...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      {/* --- 상단 네비게이션 --- */}
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800">지현이의 <span className="text-blue-600">영양 매니저</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">Premium Hospital System</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {[
            { id: 'planner', label: '식단표', icon: <Calendar size={14}/> },
            { id: 'history', label: '히스토리', icon: <History size={14}/> },
            { id: 'recipes', label: '레시피', icon: <ChefHat size={14}/> },
            { id: 'settings', label: '설정', icon: <Settings size={14}/> }
          ].map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setError(null); }} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              <div className="flex items-center gap-2">{t.icon} {t.label}</div>
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto">
        {!db && activeTab === 'settings' && (
          <div className="mb-6 p-6 bg-red-50 text-red-600 rounded-3xl border-2 border-red-200 animate-pulse">
            <p className="text-xs font-black flex items-center gap-2"><AlertCircle size={18}/> Firebase 연결이 필요합니다!</p>
            <p className="text-[10px] font-bold opacity-80 mt-1">설정값을 넣으셨다면, Vercel 대시보드에서 반드시 "Redeploy"를 눌러야 합니다.</p>
          </div>
        )}

        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold border border-red-100 flex items-center gap-3"><AlertCircle size={18}/> {error}</div>}

        {/* --- 식단표 탭 --- */}
        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="flex justify-between items-end px-4 print:hidden">
              <div><h2 className="text-2xl font-black text-slate-800 tracking-tighter">신도시이진병원 식단표</h2><p className="text-slate-400 text-[10px] font-black mt-1.5 uppercase italic">Weekly Patient Meal Plan</p></div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2 transition-all hover:scale-105"><Printer size={16}/> 인쇄</button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2 disabled:opacity-50 transition-all hover:scale-105">
                  {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 식단 생성
                </button>
              </div>
            </div>

            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-xl">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead><tr className="bg-slate-50 border-b-[3px] border-slate-300">
                    <th className="w-24 p-4 border-r-2 border-slate-200 text-[10px] font-black text-slate-400 uppercase tracking-widest">구분</th>
                    {weeklyPlan.map((day, i) => <th key={i} className={`p-4 border-r-2 border-slate-200 last:border-r-0 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>{day.date}</th>)}
                  </tr></thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">아침</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 tracking-widest text-center"><td colSpan="8" className="p-2.5">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">점심</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 tracking-widest text-center"><td colSpan="8" className="p-2.5">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">저녁</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}</tr>
                    <tr className="bg-rose-50/30 font-black text-[12px] text-rose-600 italic text-center"><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[10px] text-rose-400 uppercase">간식</td>{weeklyPlan.map((day, i) => <td key={i} className="p-4 border-r-2 border-slate-200 last:border-r-0">{day.snack || "과일쥬스"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-4 shadow-inner"><ChefHat size={64} className="mx-auto text-slate-100"/><p className="font-black text-slate-300 uppercase tracking-widest">SYSTEM ACCESS READY</p></div>}
          </div>
        )}

        {/* --- 히스토리 탭 --- */}
        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in slide-in-from-right-4">
            {historyList.map((h, i) => (
              <div key={h.id} className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 group relative overflow-hidden">
                <div className="absolute top-0 left-0 w-2 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-all" />
                <div className="flex justify-between items-start mb-6">
                  <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-4 py-1.5 rounded-full">Record #{historyList.length - i}</span>
                  <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : 'Saving...'}</span>
                </div>
                <div className="space-y-3 mb-8 text-xs font-bold text-slate-700">
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span>월 점심</span><span className="text-blue-600 truncate max-w-[120px] text-right">{h.plan[0]?.lunch[0]}</span></div>
                </div>
                <button onClick={() => { setWeeklyPlan(h.plan); setActiveTab('planner'); }} className="w-full py-4 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-2xl text-xs font-black transition-all">불러오기</button>
              </div>
            ))}
            {historyList.length === 0 && <div className="col-span-full py-32 text-center text-slate-300 font-black italic text-2xl opacity-50 uppercase tracking-widest">No History Found</div>}
          </div>
        )}

        {/* --- 레시피 탭 (복구됨) --- */}
        {activeTab === 'recipes' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-orange-500 p-3 rounded-2xl shadow-lg"><Utensils className="text-white" size={24}/></div>
                <div><h3 className="text-2xl font-black text-slate-800 tracking-tighter">AI 레시피 도우미</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">AI Cooking Assistant</p></div>
              </div>
              <div className="flex gap-4">
                <input type="text" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="메뉴를 입력하세요 (예: 소불고기)" className="flex-1 px-8 py-4 rounded-2xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm" onKeyPress={(e) => e.key === 'Enter' && generateRecipe(recipeQuery)} />
                <button onClick={() => generateRecipe(recipeQuery)} disabled={loading || !recipeQuery} className="bg-orange-500 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>} 검색
                </button>
              </div>
            </div>
            {currentRecipe && (
              <div className="bg-white p-10 rounded-[3rem] shadow-2xl border-4 border-orange-50 animate-in zoom-in-95 max-w-2xl mx-auto">
                <h4 className="text-3xl font-black text-slate-800 mb-6 flex items-center gap-3 tracking-tighter"><BookOpen className="text-orange-500"/> {currentRecipe.title}</h4>
                <div className="space-y-8">
                  <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">필수 재료</h5><div className="flex flex-wrap gap-2">{currentRecipe.ingredients.map((ing, i) => <span key={i} className="bg-orange-50 text-orange-700 px-4 py-2 rounded-xl text-xs font-bold">{ing}</span>)}</div></div>
                  <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">조리 순서</h5><div className="space-y-4">{currentRecipe.steps.map((step, i) => <div key={i} className="flex gap-4 items-start"><span className="bg-slate-800 text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span><p className="text-sm font-medium text-slate-700 leading-relaxed">{step}</p></div>)}</div></div>
                </div>
              </div>
            )}
            <div className="space-y-4">
               <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">최근 저장된 레시피</h5>
               <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {recipeList.map(r => (
                    <div key={r.id} onClick={() => setCurrentRecipe(r)} className="bg-white p-6 rounded-3xl border border-slate-100 hover:border-orange-400 transition-all cursor-pointer flex justify-between items-center group">
                      <div className="flex items-center gap-4"><div className="bg-slate-50 p-2 rounded-xl group-hover:bg-orange-50"><ChefHat size={18} className="text-slate-400 group-hover:text-orange-500"/></div><span className="font-black text-slate-700">{r.title}</span></div>
                      <span className="text-[10px] text-slate-300 font-bold">{r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString() : '...'}</span>
                    </div>
                  ))}
               </div>
            </div>
          </div>
        )}

        {/* --- 설정 탭 --- */}
        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto py-12">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 relative text-center overflow-hidden">
              {saveStatus === 'success' && <div className="absolute inset-0 bg-blue-600/95 flex flex-col items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300"><CheckCircle2 size={48} className="mb-4 animate-bounce"/>설정 저장 완료!</div>}
              <div className="flex items-center gap-4 mb-10 text-left"><div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" size={24}/></div><div><h3 className="text-2xl font-black text-slate-800 tracking-tighter">서비스 설정</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Configuration</p></div></div>
              
              <div className="mb-8 p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">DB 연결 상태</span>
                {db ? <span className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 animate-pulse"><Database size={12}/> Connected</span> : <span className="flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-100"><WifiOff size={12}/> Disconnected</span>}
              </div>

              <div className="space-y-8 text-left">
                <div><label className="block text-[11px] font-black text-slate-400 mb-3 uppercase px-1">Gemini API Key</label><input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="API 키를 입력하세요" className="w-full px-8 py-5 rounded-3xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm transition-all focus:ring-2 focus:ring-blue-500" /></div>
                <button onClick={async () => { if (!db || !user) { setError("시스템 연결이 되지 않았습니다. Redeploy를 확인하세요."); return; } setLoading(true); await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), userSettings, { merge: true }); setSaveStatus('success'); setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500); setLoading(false); }} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-xl transition-all hover:bg-black active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Save size={18}/>} 설정 저장하기
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="mt-20 py-16 text-center opacity-40 text-[10px] font-black uppercase tracking-[0.6em] text-slate-400 border-t border-slate-200 max-w-[1100px] mx-auto print:hidden">Made for Jihyun with Love by Her Husband</footer>
    </div>
  );
};

export default App;