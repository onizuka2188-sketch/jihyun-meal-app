import React, { useState, useEffect } from 'react';
import { Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, AlertCircle, Printer, History, Settings, Save, Search, BookOpen, Utensils } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// --- 환경 변수 로드 (안전한 접근 방식) ---
const getEnvVar = (key) => {
  if (typeof window !== 'undefined' && window[key]) return window[key];
  try {
    const viteKey = `VITE_${key.replace('__', '').toUpperCase()}`;
    if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env[viteKey]) {
      return import.meta.env[viteKey];
    }
  } catch (e) {}
  return null;
};

const firebaseConfigRaw = getEnvVar('__firebase_config');
const firebaseConfig = firebaseConfigRaw ? JSON.parse(firebaseConfigRaw) : null;
const appId = getEnvVar('__app_id') || 'jihyun-meal-app-v2';
const initialAuthToken = getEnvVar('__initial_auth_token');

let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [recipeList, setRecipeList] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });
  const [error, setError] = useState(null);
  const [recipeQuery, setRecipeQuery] = useState("");
  const [currentRecipe, setCurrentRecipe] = useState(null);

  // 1. 인증 처리
  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const initAuth = async () => {
      try {
        if (initialAuthToken) await signInWithCustomToken(auth, initialAuthToken);
        else await signInAnonymously(auth);
      } catch (err) { setError("인증 실패"); } finally { setAuthLoading(false); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  // 2. 데이터 로드 (히스토리, 레시피, 설정)
  useEffect(() => {
    if (!user || !db) return;

    // 히스토리 리스너
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistoryList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });

    // 레시피 리스너
    const recipeRef = collection(db, 'artifacts', appId, 'public', 'data', 'recipes');
    const unsubRecipes = onSnapshot(recipeRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setRecipeList(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    });

    // 설정 리스너
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) setUserSettings(docSnap.data());
    });

    return () => { unsubHistory(); unsubRecipes(); unsubSettings(); };
  }, [user]);

  // 3. 공통 API 키 가져오기
  const getApiKey = () => userSettings.geminiKey || getEnvVar('gemini_api_key') || "";

  // 4. 식단 생성
  const generateWeeklyPlan = async () => {
    const key = getApiKey();
    if (!key) { setError("설정 탭에서 API 키를 먼저 저장해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    const prompt = `병원 영양사 지현이를 위한 주간 식단표를 JSON으로 짜줘. 7일치 데이터가 필요해.`;
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "병원 식단표 전문가처럼 행동해. 결과는 JSON {days: []} 형식으로만 줘." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("식단 생성 실패"); } finally { setLoading(false); }
  };

  // 5. 레시피 생성
  const generateRecipe = async (query) => {
    const key = getApiKey();
    if (!key) { setError("설정에서 API 키를 입력하세요."); return; }
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${query} 레시피를 병원 환자식 기준으로 상세히 알려줘.` }] }],
          systemInstruction: { parts: [{ text: "JSON 형식으로 답변해: {title, ingredients: [], steps: []}" }] },
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
    <div className="flex flex-col items-center justify-center py-2 min-h-[120px] leading-tight print:min-h-0 print:py-1">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>{item}</span>
      ))}
    </div>
  );

  if (authLoading) return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center gap-4">
      <Loader2 className="animate-spin text-blue-600" size={48} /><p className="font-black text-slate-400 text-xs uppercase tracking-widest">System Accessing...</p>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-200"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none italic">지현이의 <span className="text-blue-600 font-black">영양 매니저</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1.5">Premium Hospital Meal System</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {[
            { id: 'planner', label: '식단표', icon: <Calendar size={14}/> },
            { id: 'history', label: '히스토리', icon: <History size={14}/> },
            { id: 'recipes', label: '레시피', icon: <ChefHat size={14}/> },
            { id: 'settings', label: '설정', icon: <Settings size={14}/> }
          ].map(t => (
            <button key={t.id} onClick={() => setActiveTab(t.id)} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto">
        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold border border-red-100 flex items-center gap-3"><AlertCircle size={18}/> {error}</div>}

        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="flex justify-between items-end px-4 print:hidden">
              <div><h2 className="text-2xl font-black text-slate-800">신도시이진병원 식단표</h2><p className="text-slate-400 text-[10px] font-black mt-1.5 uppercase italic">Weekly Patient Meal Plan</p></div>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2"><Printer size={16}/> 인쇄</button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg flex items-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 식단 자동 생성</button>
              </div>
            </div>
            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-xl">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead><tr className="bg-slate-50 border-b-[3px] border-slate-300">
                    <th className="w-24 p-4 border-r-2 border-slate-200 text-[10px] font-black text-slate-400 uppercase">구분</th>
                    {weeklyPlan.map((day, i) => <th key={i} className={`p-4 border-r-2 border-slate-200 last:border-r-0 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>{day.date}</th>)}
                  </tr></thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">아침</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}</tr>
                    <tr className="bg-blue-50/20"><td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic text-center">粥</td><td colSpan="7" className="p-2.5 text-[12px] font-bold text-blue-800 tracking-widest">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">점심</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}</tr>
                    <tr className="bg-blue-50/20"><td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic text-center">粥</td><td colSpan="7" className="p-2.5 text-[12px] font-bold text-blue-800 tracking-widest">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">저녁</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}</tr>
                    <tr className="bg-rose-50/30"><td className="border-r-2 border-slate-200 font-bold text-[10px] text-rose-400 italic text-center uppercase">간식</td>{weeklyPlan.map((day, i) => <td key={i} className="p-4 border-r-2 border-slate-200 last:border-r-0 text-[12px] font-black text-rose-600 italic">{day.snack || "과일쥬스"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-4"><ChefHat size={64} className="mx-auto text-slate-200"/><p className="font-black text-slate-300 uppercase tracking-widest">Access Ready</p></div>}
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
                  <div className="flex justify-between border-b border-slate-50 pb-2"><span>대표 점심</span><span className="text-blue-600">{h.plan[0].lunch[0]}</span></div>
                </div>
                <button onClick={() => {setWeeklyPlan(h.plan); setActiveTab('planner');}} className="w-full py-4 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-2xl text-xs font-black transition-all active:scale-95">불러오기</button>
              </div>
            ))}
          </div>
        )}

        {/* --- 레시피 탭 (복구 및 강화됨) --- */}
        {activeTab === 'recipes' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-orange-500 p-3 rounded-2xl shadow-lg shadow-orange-100"><Utensils className="text-white" size={24}/></div>
                <div><h3 className="text-2xl font-black text-slate-800">AI 레시피 도우미</h3><p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">AI Powered Cooking Assistant</p></div>
              </div>
              <div className="flex gap-4">
                <input type="text" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="레시피가 궁금한 메뉴를 입력하세요 (예: 소불고기)" className="flex-1 px-8 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-orange-500 font-bold shadow-inner outline-none" onKeyPress={(e) => e.key === 'Enter' && generateRecipe(recipeQuery)} />
                <button onClick={() => generateRecipe(recipeQuery)} disabled={loading || !recipeQuery} className="bg-orange-500 hover:bg-orange-600 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg transition-all active:scale-95 flex items-center gap-2">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>} 검색
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {currentRecipe && (
                <div className="bg-white p-10 rounded-[3rem] shadow-2xl border-4 border-orange-50 animate-in zoom-in-95">
                  <h4 className="text-3xl font-black text-slate-800 mb-6 flex items-center gap-3"><BookOpen className="text-orange-500"/> {currentRecipe.title}</h4>
                  <div className="space-y-8">
                    <div><h5 className="text-xs font-black text-orange-500 uppercase tracking-widest mb-4">필수 재료</h5><div className="flex flex-wrap gap-2">{currentRecipe.ingredients.map((ing, i) => <span key={i} className="bg-orange-50 text-orange-700 px-4 py-2 rounded-xl text-xs font-bold border border-orange-100">{ing}</span>)}</div></div>
                    <div><h5 className="text-xs font-black text-orange-500 uppercase tracking-widest mb-4">조리 순서</h5><div className="space-y-4">{currentRecipe.steps.map((step, i) => <div key={i} className="flex gap-4 items-start"><span className="bg-slate-800 text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span><p className="text-sm font-medium text-slate-700 leading-relaxed">{step}</p></div>)}</div></div>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <h5 className="text-xs font-black text-slate-400 uppercase tracking-widest px-4">저장된 레시피 목록</h5>
                {recipeList.map((r) => (
                  <div key={r.id} onClick={() => setCurrentRecipe(r)} className="bg-white p-6 rounded-3xl shadow-sm border border-slate-100 hover:border-orange-500 transition-all cursor-pointer flex justify-between items-center group">
                    <div className="flex items-center gap-4"><div className="bg-slate-50 p-2.5 rounded-xl group-hover:bg-orange-50 transition-colors"><ChefHat size={20} className="text-slate-400 group-hover:text-orange-500"/></div><span className="font-black text-slate-700">{r.title}</span></div>
                    <span className="text-[10px] text-slate-300 font-bold">{r.createdAt ? new Date(r.createdAt.seconds * 1000).toLocaleDateString() : '...'}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto py-12 animate-in zoom-in">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100">
              <div className="flex items-center gap-4 mb-10"><div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" size={24}/></div><h3 className="text-2xl font-black text-slate-800">서비스 설정</h3></div>
              <div className="space-y-8">
                <div><label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest">Gemini API Key</label><input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="API 키를 입력하세요" className="w-full px-8 py-5 rounded-3xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm" /></div>
                <button onClick={async () => { if (!user || !db) return; setLoading(true); await setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), userSettings, { merge: true }); setLoading(false); setActiveTab('planner'); }} className="w-full py-5 bg-slate-900 text-white rounded-3xl font-black shadow-xl transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2">{loading ? <Loader2 className="animate-spin" size={16}/> : <Save size={16}/>} 설정 저장하기</button>
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