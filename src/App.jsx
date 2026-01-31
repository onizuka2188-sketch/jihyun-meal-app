import React, { useState, useEffect, useCallback, useRef } from 'react';
import { 
  Calendar, ChefHat, RefreshCw, Loader2, Key, Heart, Info, 
  AlertCircle, Printer, History, Settings, Save, Search, 
  BookOpen, Utensils, CheckCircle2, Database, WifiOff, ShieldCheck, BrainCircuit, Camera, Image as ImageIcon, Upload
} from 'lucide-react';
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

const getEnv = (key) => {
  const vKey = `VITE_${key.toUpperCase()}`;
  if (typeof window !== 'undefined' && window[vKey]) return window[vKey];
  try {
    const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
    return env[vKey] || null;
  } catch (e) { return null; }
};

const rawConfig = getEnv('FIREBASE_CONFIG');
let firebaseConfig = null;
try {
  if (rawConfig) {
    let cleaned = rawConfig.trim();
    if (cleaned.includes('{') && cleaned.includes('}')) {
      cleaned = cleaned.substring(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1);
    }
    const safeJson = cleaned.replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":').replace(/'/g, '"');
    firebaseConfig = JSON.parse(safeJson);
  }
} catch (e) { }

const appId = getEnv('APP_ID') || 'jihyun-meal-final-fix';

let app, auth, db;
if (firebaseConfig && firebaseConfig.apiKey) {
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
  } catch (e) { }
}

const App = () => {
  const [user, setUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [visionLoading, setVisionLoading] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); 
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [historyList, setHistoryList] = useState([]);
  const [recipeList, setRecipeList] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [error, setError] = useState(null);
  const fileInputRef = useRef(null);

  const [recipeQuery, setRecipeQuery] = useState("");
  const [currentRecipe, setCurrentRecipe] = useState(null);

  const [userSettings, setUserSettings] = useState({ 
    geminiKey: "",
    learningData: "이전 식단표 사진을 분석하면 여기에 텍스트가 쌓입니다." 
  });

  useEffect(() => {
    if (!auth) { setAuthLoading(false); return; }
    const unsub = onAuthStateChanged(auth, (u) => {
      if (!u) signInAnonymously(auth).catch(() => {});
      setUser(u);
      setAuthLoading(false);
    });
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

  const handleImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const key = userSettings.geminiKey || getEnv('GEMINI_API_KEY') || "";
    if (!key) { setError("Gemini API 키가 필요합니다."); setActiveTab('settings'); return; }
    setVisionLoading(true); setError(null);
    try {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = async () => {
        const base64Data = reader.result.split(',')[1];
        const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: "이 사진의 메뉴 정보를 텍스트로 추출해줘." }, { inlineData: { mimeType: file.type, data: base64Data } }] }]
          })
        });
        const result = await res.json();
        const extractedText = result.candidates[0].content.parts[0].text;
        setUserSettings(prev => ({ ...prev, learningData: prev.learningData + "\n" + extractedText }));
        setVisionLoading(false);
        setSaveStatus('learning_success');
        setTimeout(() => setSaveStatus(null), 2000);
      };
    } catch (err) { setError("사진 분석 실패"); setVisionLoading(false); }
  };

  const generateWeeklyPlan = async () => {
    const key = userSettings.geminiKey || getEnv('GEMINI_API_KEY') || "";
    if (!key) { setError("Gemini API 키를 입력해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);

    const prompt = `당신은 전문 영양사입니다. 다음 데이터를 참고하여 7일치 주간 식단표를 만드세요.
    참고 데이터: ${userSettings.learningData}
    반드시 다음 JSON 형식을 한 자도 틀리지 말고 지키세요:
    { "days": [ { "date": "1/1(월)", "breakfast": ["메뉴1", "메뉴2", "메뉴3", "메뉴4", "메뉴5"], "lunch": [...], "dinner": [...], "snack": "간식메뉴" } ] }`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          systemInstruction: { parts: [{ text: "오직 지정된 JSON 형식으로만 응답하세요. breakfast, lunch, dinner는 반드시 5개의 문자열 배열이어야 합니다." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      if (data.days) {
        setWeeklyPlan(data.days);
        if (db && user) addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid }).catch(() => {});
      } else { throw new Error(); }
    } catch (err) { setError("식단 생성 중 데이터 오류가 발생했습니다. 다시 시도해 주세요."); } finally { setLoading(false); }
  };

  const generateRecipe = async (q) => {
    const key = userSettings.geminiKey || getEnv('GEMINI_API_KEY') || "";
    if (!key || !q) return;
    setLoading(true); setError(null);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${q}의 상세 레시피를 알려줘.` }] }],
          systemInstruction: { parts: [{ text: "JSON {title, ingredients: [], steps: []} 형식으로 답변하세요." }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setCurrentRecipe(data);
      if (db && user) addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'recipes'), { ...data, createdAt: serverTimestamp(), userId: user.uid }).catch(() => {});
    } catch (err) { setError("레시피 생성 실패"); } finally { setLoading(false); }
  };

  const renderCell = (items, isLunch = false) => {
    const list = Array.isArray(items) ? items : ["메뉴 정보 없음"];
    return (
      <div className="flex flex-col items-center justify-center py-2 min-h-[110px] leading-tight">
        {list.map((item, i) => (
          <span key={i} className={`text-[12px] md:text-[13px] ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>{item}</span>
        ))}
      </div>
    );
  };

  if (authLoading) return <div className="min-h-screen flex items-center justify-center bg-white"><Loader2 className="animate-spin text-blue-600" size={40} /></div>;

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      <nav className="max-w-[1100px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center bg-white p-6 rounded-[2.5rem] shadow-xl border border-white print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100 transition-transform hover:scale-110"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div><h1 className="text-xl font-black text-slate-800 tracking-tighter italic">지현이의 <span className="text-blue-600">영양 매니저</span></h1></div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {[{id:'planner',label:'식단표',icon:<Calendar size={14}/>},{id:'history',label:'히스토리',icon:<History size={14}/>},{id:'recipes',label:'레시피',icon:<ChefHat size={14}/>},{id:'settings',label:'설정',icon:<Settings size={14}/>}].map(t => (
            <button key={t.id} onClick={() => { setActiveTab(t.id); setError(null); }} className={`px-6 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t.id ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500 hover:text-slate-800'}`}>
              <div className="flex items-center gap-2">{t.icon} {t.label}</div>
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1100px] mx-auto">
        {!db && activeTab === 'planner' && <div className="mb-6 px-6 py-3 bg-blue-50 text-blue-600 rounded-full text-[10px] font-black flex items-center gap-2 border border-blue-100 print:hidden uppercase tracking-widest"><Info size={14}/> Offline Mode Enabled</div>}
        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold border border-red-100 flex items-center gap-3"><AlertCircle size={18}/> {error}</div>}

        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-700">
            <div className="flex justify-between items-end px-4 print:hidden">
              <h2 className="text-2xl font-black text-slate-800 tracking-tighter italic">신도시이진병원 식단표</h2>
              <div className="flex gap-3">
                <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-3 rounded-2xl font-black text-xs flex items-center gap-2 transition-all active:scale-95"><Printer size={16}/> 인쇄</button>
                <button onClick={generateWeeklyPlan} disabled={loading} className="bg-blue-600 text-white px-6 py-3 rounded-2xl font-black text-xs flex items-center gap-2 shadow-lg disabled:opacity-50 transition-all active:scale-95">
                  {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} 식단 자동 생성
                </button>
              </div>
            </div>

            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-xl">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead><tr className="bg-slate-50 border-b-[3px] border-slate-300">
                    <th className="w-24 p-4 border-r-2 border-slate-200 text-[10px] font-black text-slate-400">구분</th>
                    {weeklyPlan.map((day, i) => <th key={i} className={`p-4 border-r-2 border-slate-200 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>{day.date || "날짜정보"}</th>)}
                  </tr></thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">아침</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.breakfast)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 text-center"><td colSpan="8" className="p-2.5 font-black uppercase tracking-widest text-[10px]">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">점심</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.lunch, true)}</td>)}</tr>
                    <tr className="bg-blue-50/20 font-bold text-[12px] text-blue-800 text-center"><td colSpan="8" className="p-2.5 font-black uppercase tracking-widest text-[10px]">쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)</td></tr>
                    <tr><td className="bg-slate-50 font-black text-[11px] text-slate-400 text-center">저녁</td>{weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 align-top">{renderCell(day.dinner)}</td>)}</tr>
                    <tr className="bg-rose-50/30 font-black text-[12px] text-rose-600 italic text-center"><td className="bg-slate-50 font-black text-[10px] text-rose-400 text-center">간식</td>{weeklyPlan.map((day, i) => <td key={i} className="p-4 border-r-2 border-slate-200 font-black">{day.snack || "과일쥬스"}</td>)}</tr>
                  </tbody>
                </table>
              </div>
            ) : <div className="bg-white p-24 rounded-[3.5rem] border-[4px] border-dashed border-slate-200 text-center space-y-4 shadow-inner"><ChefHat size={64} className="mx-auto text-slate-100"/><p className="font-black text-slate-300 uppercase tracking-widest">데이터를 생성해 주세요</p></div>}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {historyList.map((h, i) => (
              <div key={h.id} className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 hover:border-blue-400 transition-all group overflow-hidden relative">
                <div className="flex justify-between items-start mb-6">
                  <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-4 py-1.5 rounded-full uppercase">Record #{historyList.length - i}</span>
                  <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : '...'}</span>
                </div>
                <button onClick={() => { setWeeklyPlan(h.plan); setActiveTab('planner'); }} className="w-full py-4 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-2xl text-xs font-black transition-all">불러오기</button>
              </div>
            ))}
            {historyList.length === 0 && <div className="col-span-full py-32 text-center text-slate-300 font-black italic">No History Found</div>}
          </div>
        )}

        {activeTab === 'recipes' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100">
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-orange-500 p-3 rounded-2xl shadow-lg"><Utensils className="text-white" size={24}/></div>
                <div><h3 className="text-2xl font-black text-slate-800 tracking-tighter italic">AI 레시피 도우미</h3></div>
              </div>
              <div className="flex gap-4">
                <input type="text" value={recipeQuery} onChange={(e) => setRecipeQuery(e.target.value)} placeholder="메뉴를 입력하세요" className="flex-1 px-8 py-4 rounded-2xl bg-slate-50 border-none font-bold shadow-inner outline-none text-sm" onKeyPress={(e) => e.key === 'Enter' && generateRecipe(recipeQuery)} />
                <button onClick={() => generateRecipe(recipeQuery)} disabled={loading || !recipeQuery} className="bg-orange-500 text-white px-8 py-4 rounded-2xl font-black text-sm shadow-lg transition-all hover:scale-105">
                  {loading ? <Loader2 className="animate-spin" size={18}/> : <Search size={18}/>} 검색
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              {currentRecipe && (
                <div className="bg-white p-10 rounded-[3rem] shadow-2xl border-4 border-orange-50 animate-in zoom-in-95">
                  <h4 className="text-3xl font-black text-slate-800 mb-6 flex items-center gap-3 tracking-tighter"><BookOpen className="text-orange-500"/> {currentRecipe.title}</h4>
                  <div className="space-y-8">
                    <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">필수 재료</h5><div className="flex flex-wrap gap-2">{currentRecipe.ingredients.map((ing, i) => <span key={i} className="bg-orange-50 text-orange-700 px-4 py-2 rounded-xl text-xs font-bold">{ing}</span>)}</div></div>
                    <div><h5 className="text-[10px] font-black text-orange-500 uppercase tracking-widest mb-4">조리 순서</h5><div className="space-y-4">{currentRecipe.steps.map((step, i) => <div key={i} className="flex gap-4 items-start"><span className="bg-slate-800 text-white w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black shrink-0">{i+1}</span><p className="text-sm font-medium text-slate-700 leading-relaxed">{step}</p></div>)}</div></div>
                  </div>
                </div>
              )}
              <div className="space-y-4">
                <h5 className="text-[10px] font-black text-slate-400 uppercase tracking-widest px-4">최근 저장된 레시피</h5>
                <div className="grid grid-cols-1 gap-3">
                  {recipeList.map(r => (
                    <div key={r.id} onClick={() => {setCurrentRecipe(r); window.scrollTo({top: 0, behavior: 'smooth'});}} className="bg-white p-6 rounded-3xl border border-slate-100 hover:border-orange-400 transition-all cursor-pointer flex justify-between items-center group shadow-sm">
                      <div className="flex items-center gap-4"><ChefHat size={18} className="text-slate-400 group-hover:text-orange-500"/><span className="font-black text-slate-700 text-sm">{r.title}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto py-12 animate-in zoom-in">
            <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-slate-100 relative overflow-hidden">
              {saveStatus === 'learning_success' && <div className="absolute inset-0 bg-blue-600 flex flex-col items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300">학습 완료!</div>}
              {saveStatus === 'success' && <div className="absolute inset-0 bg-blue-600 flex items-center justify-center text-white z-20 font-black text-2xl animate-in fade-in duration-300">저장 완료!</div>}
              <div className="flex items-center gap-4 mb-8"><div className="bg-blue-600 p-4 rounded-2xl shadow-lg"><BrainCircuit className="text-white" size={24}/></div><h3 className="text-2xl font-black text-slate-800 italic">시스템 설정 및 학습</h3></div>
              <div className="space-y-10">
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 shadow-inner">
                  <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase px-1">Gemini API Key</label>
                  <input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="API 키를 입력하세요" className="w-full px-8 py-5 rounded-3xl bg-white border-none font-bold shadow-sm outline-none text-sm focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="p-8 bg-blue-50/50 rounded-[2.5rem] border-2 border-dashed border-blue-200">
                  <h4 className="font-black text-blue-700 text-lg tracking-tighter mb-4 italic">식단표 사진으로 학습하기</h4>
                  <input type="file" accept="image/*" className="hidden" ref={fileInputRef} onChange={handleImageUpload} />
                  <button onClick={() => fileInputRef.current.click()} disabled={visionLoading} className="w-full py-10 bg-white border-2 border-dashed border-blue-200 rounded-[2rem] flex flex-col items-center justify-center gap-4 hover:bg-blue-50 transition-all group">
                    {visionLoading ? <Loader2 className="animate-spin text-blue-600" size={32} /> : <><Upload className="text-blue-600" size={24}/><p className="text-sm font-black text-slate-500">사진을 선택하세요</p></>}
                  </button>
                </div>
                <div className="p-8 bg-slate-50 rounded-[2.5rem] border border-slate-100 shadow-inner">
                  <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase px-1">누적 학습 데이터</label>
                  <textarea value={userSettings.learningData} onChange={(e) => setUserSettings({...userSettings, learningData: e.target.value})} className="w-full px-8 py-6 rounded-3xl bg-white border-none font-bold shadow-sm outline-none text-xs h-40 resize-none leading-relaxed" />
                </div>
                <button onClick={() => { if(db && user) { setLoading(true); setDoc(doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config'), userSettings, { merge: true }).then(() => { setSaveStatus('success'); setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500); }).finally(() => setLoading(false)); } else { setSaveStatus('success'); setTimeout(() => { setSaveStatus(null); setActiveTab('planner'); }, 1500); } }} className="w-full py-6 bg-slate-900 text-white rounded-[2rem] font-black shadow-2xl transition-all hover:bg-black active:scale-95 flex items-center justify-center gap-2"><Save size={18}/> 설정 저장</button>
              </div>
            </div>
          </div>
        )}
      </main>
      <footer className="mt-20 py-16 text-center opacity-30 text-[10px] font-black border-t border-slate-200 max-w-[1100px] mx-auto print:hidden uppercase tracking-[0.5em]">Jihyun's AI Nutrition Manager</footer>
    </div>
  );
};

export default App;