import React, { useState, useEffect, useCallback } from 'react';
import { 
  Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, 
  AlertCircle, Printer, History, Settings, Save, Search, 
  BookOpen, Utensils, CheckCircle2, Database, WifiOff, ExternalLink, ShieldCheck, ClipboardCheck
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

/**
 * [초강력 환경 변수 탐지기]
 * 지현님이 Vercel에 어떤 이름으로 넣었든 무조건 찾아냅니다.
 */
const findEnv = (key) => {
  const upperKey = key.toUpperCase();
  const viteKey = `VITE_${upperKey}`;
  
  if (typeof window !== 'undefined') {
    if (window[viteKey]) return window[viteKey];
    if (window[upperKey]) return window[upperKey];
    if (window[`__${key.toLowerCase()}`]) return window[`__${key.toLowerCase()}`];
  }

  try {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    return env[viteKey] || env[upperKey] || null;
  } catch (e) {
    return null;
  }
};

// [스마트 파서] 지현님이 불필요한 글자를 포함해서 붙여넣어도 알맹이만 골라냅니다.
const parseFirebaseConfig = (raw) => {
  if (!raw) return { config: null, error: "Vercel 설정에서 'VITE_FIREBASE_CONFIG'를 찾을 수 없습니다." };
  
  let cleaned = raw.trim();
  try {
    // 만약 "const firebaseConfig = { ... };" 처럼 붙여넣었다면 { } 부분만 추출합니다.
    if (cleaned.includes('{') && cleaned.includes('}')) {
      cleaned = cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
    }
    const parsed = JSON.parse(cleaned);
    if (!parsed.apiKey) return { config: null, error: "알맹이는 찾았으나 'apiKey' 정보가 없습니다. 다시 복사해 주세요." };
    return { config: parsed, error: null };
  } catch (e) {
    return { config: null, error: "정보의 형식이 잘못되었습니다. 중괄호 { } 안에 쉼표(,)나 따옴표(\")가 정확한지 확인하세요." };
  }
};

const { config: firebaseConfig, error: configError } = parseFirebaseConfig(findEnv('FIREBASE_CONFIG'));
const appId = findEnv('APP_ID') || 'jihyun-meal-pro';
const initialAuthToken = findEnv('INITIAL_AUTH_TOKEN');

// Firebase 초기화
let app, auth, db;
if (firebaseConfig) {
  try {
    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
      auth = getAuth(app);
      db = getFirestore(app);
    } else {
      app = getApps()[0];
      auth = getAuth(app);
      db = getFirestore(app);
    }
  } catch (e) {
    console.error("Firebase Init Failed");
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

  useEffect(() => {
    const initAuth = async () => {
      if (!auth) { setAuthLoading(false); return; }
      try {
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);
      } catch (err) {
        console.error("Auth Fail");
      } finally {
        setAuthLoading(false);
      }
    };
    initAuth();
    const unsub = auth ? onAuthStateChanged(auth, setUser) : () => {};
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setHistoryList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    const recipeRef = collection(db, 'artifacts', appId, 'public', 'data', 'recipes');
    const unsubRecipes = onSnapshot(recipeRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setRecipeList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (d) => {
      if (d.exists()) setUserSettings(d.data());
    });
    return () => { unsubHistory(); unsubRecipes(); unsubSettings(); };
  }, [user]);

  const getApiKey = useCallback(() => {
    return userSettings.geminiKey || findEnv('GEMINI_API_KEY') || "";
  }, [userSettings.geminiKey]);

  const handleSaveSettings = async () => {
    if (!db || !user) {
      setError("연결이 되지 않아 저장할 수 없습니다.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
      await setDoc(settingsRef, userSettings, { merge: true });
      setSaveStatus('success');
      setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500);
    } catch (err) {
      setError("데이터베이스 저장에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const generateWeeklyPlan = async () => {
    const key = getApiKey();
    if (!key) { setError("설정에서 API 키를 먼저 입력해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "병원 환자용 주간 식단표(월~일)를 짜줘." }] }],
          systemInstruction: { parts: [{ text: "영양사로서 JSON {days: []} 형식으로만 답하세요." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("식단 생성에 실패했습니다."); } finally { setLoading(false); }
  };

  const generateRecipe = async (q) => {
    const key = getApiKey();
    if (!key || !q) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${q}의 상세 레시피를 병원식 기준으로 알려줘.` }] }],
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
    <div className="flex flex-col items-center justify-center py-2 min-h-[120px] leading-tight">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>{item}</span>
      ))}
    </div>
  );

  if (authLoading) return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white gap-4">
      <Loader2 className="animate-spin text-blue-600" size={48} />
      <p className="font-black text-slate-400 text-xs tracking-widest uppercase">지현 매니저 부팅 중...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tighter">지현이의 <span className="text-blue-600">영양 매니저</span></h1>
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
        {!db && (
          <div className="mb-6 p-5 bg-red-50 text-red-600 rounded-3xl border-2 border-red-200 flex items-center justify-between animate-in slide-in-from-top-4">
            <div className="flex items-center gap-3">
              <AlertCircle size={20} className="shrink-0 animate-bounce"/> 
              <div className="text-xs font-bold leading-tight">
                <p>Firebase 연결에 문제가 있습니다!</p>
                <p className="opacity-70 mt-1">Vercel 설정에 'VITE_FIREBASE_CONFIG'를 정확히 넣고 Redeploy 했는지 확인하세요.</p>
              </div>
            </div>
            <button onClick={() => setActiveTab('settings')} className="bg-red-600 text-white px-4 py-2 rounded-xl text-[10px] font-black shrink-0">해결 방법 보기</button>
          </div>
        )}

        {error && db && <div className="mb-6 p-4 bg-amber-50 text-amber-700 rounded-2xl text-xs font-bold border border-amber-100 flex items-center gap-3"><AlertCircle size={18}/> {error}</div>}

        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="flex justify-between items-end px-4 print:hidden">
              <div><h2 className="text-2xl font-black text-slate-800 tracking-tighter">신도시이진병원 식단표</h2><p className="text-slate-400 text-[10px] font-black mt-1.5 uppercase italic">Weekly Patient Meal Plan</p></div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95"><Printer size={16}/> 인쇄</button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2 transition-all hover:scale-105 active:scale-95 disabled:opacity-50">
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
                    <tr className="bg-rose-50/30 font-black text-[12px] text-rose-600 italic text-center"><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[10px] text-rose-400 uppercase">간식</td>{weeklyPlan.map((day, i) => <td key={i} className="p-4 border-r-2 border-slate-200 last:border-r-0 text-[12px] font-black">{day.snack || "과일쥬스"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-4 shadow-inner"><ChefHat size={64} className="mx-auto text-slate-100"/><p className="font-black text-slate-300 uppercase tracking-widest">SYSTEM ACCESS READY</p></div>}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in slide-in-from-right-4">
            {historyList.map((h, i) => (
              <div key={h.id} className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 hover:border-blue-400 transition-all group overflow-hidden relative">
                <div className="absolute top-0 left-0 w-2 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-all" />
                <div className="flex justify-between items-start mb-6">
                  <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-4 py-1.5 rounded-full uppercase">Record #{historyList.length - i}</span>
                  <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : 'Saving...'}</span>
                </div>
                <div className="space-y-3 mb-8 text-xs font-bold text-slate-700">
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span>월 점심</span><span className="text-blue-600 truncate max-w-[120px] text-right">{h.plan[0]?.lunch[0]}</span></div>
                </div>
                <button onClick={() => { setWeeklyPlan(h.plan); setActiveTab('planner'); }} className="w-full py-4 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-2xl text-xs font-black transition-all active:scale-95">불러오기</button>
              </div>
            ))}
            {historyList.length === 0 && <div className="col-span-full py-32 text-center text-slate-300 font-black italic text-2xl opacity-50 uppercase tracking-widest">No History Found</div>}
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-orange-500 p-3 rounded-2xl shadow-lg"><Utensils className="text-white" size={24}/></div>
                <div><h3 className="text-2xl font-black text-slate-800 tracking-tighter">AI 레시피 도우미</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">AI Cooking Assistant</p></div>
              </div>
              <div className="flex gap-4">
                <input type="text" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="메뉴를 입력하세요 (예: 소불고기)" className="flex-1 px-8 py-4 rounded-2xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm focus:ring-2 focus:ring-orange-500" onKeyPress={(e) => e.key === 'Enter' && generateRecipe(recipeQuery)} />
                <button onClick={() => generateRecipe(recipeQuery)} disabled={loading || !recipeQuery} className="bg-orange-500 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg transition-all hover:scale-105 active:scale-95">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>} 검색
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {currentRecipe && (
                <div className="bg-white p-10 rounded-[3rem] shadow-2xl border-4 border-orange-50 animate-in zoom-in-95">
                  <h4 className="text-3xl font-black text-slate-800 mb-6 flex items-center gap-3 tracking-tighter"><BookOpen className="text-orange-500"/> {currentRecipe.title}</h4>
                  <div className="space-y-8">
                    <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">필수 재료</h5><div className="flex flex-wrap gap-2">{currentRecipe.ingredients.map((ing, i) => <span key={i} className="bg-orange-50 text-orange-700 px-4 py-2 rounded-xl text-xs font-bold border border-orange-100">{ing}</span>)}</div></div>
                    <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">조리 순서</h5><div className="space-y-4">{currentRecipe.steps.map((step, i) => <div key={i} className="flex gap-4 items-start"><span className="bg-slate-800 text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span><p className="text-sm font-medium text-slate-700 leading-relaxed">{step}</p></div>)}</div></div>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">최근 저장된 레시피</h5>
                <div className="grid grid-cols-1 gap-3">
                  {recipeList.map(r => (
                    <div key={r.id} onClick={() => {setCurrentRecipe(r); window.scrollTo({top: 0, behavior: 'smooth'});}} className="bg-white p-6 rounded-3xl border border-slate-100 hover:border-orange-400 transition-all cursor-pointer flex justify-between items-center group shadow-sm">
                      <div className="flex items-center gap-4"><div className="bg-slate-50 p-2 rounded-xl group-hover:bg-orange-50 transition-colors"><ChefHat size={18} className="text-slate-400 group-hover:text-orange-500"/></div><span className="font-black text-slate-700 text-sm">{r.title}</span></div>
                      <span className="text-[10px] text-slate-300 font-bold">{r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString() : '...'}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto py-12 animate-in zoom-in">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 relative overflow-hidden">
              {saveStatus === 'success' && <div className="absolute inset-0 bg-blue-600/95 flex flex-col items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300 px-8 text-center"><CheckCircle2 size={48} className="mb-4 animate-bounce"/>설정 저장 완료!</div>}
              
              <div className="flex items-center gap-4 mb-8"><div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" size={24}/></div><div><h3 className="text-2xl font-black text-slate-800 tracking-tighter">서비스 설정</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">System Diagnosis</p></div></div>
              
              {/* 시스템 진단창 */}
              <div className="mb-8 space-y-3">
                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-between">
                  <span className="text-[11px] font-black text-slate-500 uppercase tracking-widest">데이터베이스 연결</span>
                  {db ? <span className="flex items-center gap-1.5 text-xs font-bold text-green-600 bg-green-50 px-3 py-1 rounded-full border border-green-100 animate-pulse"><Database size={12}/> Connected</span> : <span className="flex items-center gap-1.5 text-xs font-bold text-red-600 bg-red-50 px-3 py-1 rounded-full border border-red-100"><WifiOff size={12}/> Disconnected</span>}
                </div>
                
                {!db && (
                  <div className="p-5 bg-amber-50 rounded-2xl border border-amber-100 space-y-4">
                    <h4 className="text-[11px] font-black text-amber-700 uppercase flex items-center gap-2"><Info size={14}/> 진단 결과</h4>
                    <div className="p-3 bg-white rounded-xl border border-amber-200">
                       <p className="text-[11px] text-red-600 font-black leading-relaxed italic">"{configError}"</p>
                    </div>
                    <div className="space-y-3">
                       <p className="text-[10px] text-amber-800 font-bold underline">✅ 이렇게 고쳐보세요:</p>
                       <ol className="text-[10px] text-amber-700 font-medium space-y-2 list-decimal px-4">
                          <li>Vercel의 <strong>VITE_FIREBASE_CONFIG</strong>에 넣은 값을 <strong>전부 지우세요.</strong></li>
                          <li>Firebase 설정 화면에서 <strong>오직 중괄호 {"{"} 로 시작해서 {"}"} 로 끝나는 뭉치</strong>만 다시 복사하세요.</li>
                          <li>앞에 <code>const config =</code> 같은 글자가 있으면 <strong>절대 안 됩니다!</strong></li>
                          <li>다시 저장한 후, 반드시 <strong>Deployments 탭에서 Redeploy</strong>를 누르세요.</li>
                       </ol>
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-8">
                <div>
                  <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest px-1">Gemini API Key</label>
                  <input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="API 키를 입력하세요" className="w-full px-8 py-4 rounded-2xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm transition-all focus:ring-2 focus:ring-blue-500" />
                </div>
                <button onClick={handleSaveSettings} disabled={loading} className={`w-full py-5 text-white rounded-3xl font-black shadow-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 ${db ? 'bg-slate-900 hover:bg-black' : 'bg-slate-200 text-slate-400 cursor-not-allowed'}`}>
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