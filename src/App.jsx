import React, { useState, useEffect } from 'react';
import { Search, Calendar, Utensils, RefreshCw, ChefHat, BookOpen, AlertCircle, Loader2, Clock, Users, Flame, ChevronRight, Copy, CheckCircle2, ListChecks, Info, History, Heart, Settings, Key, Save } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

/**
 * [Vercel 배포 최종 안내]
 * 1. GitHub에 이 코드를 올린 후 Vercel 대시보드로 이동하세요.
 * 2. Settings > Environment Variables에서 VITE_FIREBASE_CONFIG 등을 등록해야 저장 기능이 작동합니다.
 */

// --- 환경 변수 통합 관리 (Vercel & Preview 대응) ---
let FB_CONFIG_STR = null;
let APP_ID = 'jihyun-diet-app';

try {
  // Vercel(Vite) 빌드 환경용
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    FB_CONFIG_STR = import.meta.env.VITE_FIREBASE_CONFIG || null;
    APP_ID = import.meta.env.VITE_APP_ID || 'jihyun-diet-app';
  }
} catch (e) {
  // 미리보기(Canvas) 환경 대응
  if (typeof __firebase_config !== 'undefined') FB_CONFIG_STR = __firebase_config;
  if (typeof __app_id !== 'undefined') APP_ID = __app_id;
}

const FIREBASE_CONFIG = FB_CONFIG_STR ? (typeof FB_CONFIG_STR === 'string' ? JSON.parse(FB_CONFIG_STR) : FB_CONFIG_STR) : null;

// Firebase 초기화
let auth, db;
if (FIREBASE_CONFIG) {
  const app = initializeApp(FIREBASE_CONFIG);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [imageLoading, setImageLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recipeData, setRecipeData] = useState(null);
  const [recipeImage, setRecipeImage] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  // API 키 및 개인 설정 상태
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });
  const [isSettingsSaving, setIsSettingsSaving] = useState(false);

  useEffect(() => {
    if (!auth) return;
    const performSignIn = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("인증 실패:", err); }
    };
    performSignIn();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = historyData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setHistory(sorted);
    });
    const settingsRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) setUserSettings(docSnap.data());
    });
    return () => { unsubHistory(); unsubSettings(); };
  }, [user]);

  const getActiveKey = () => {
    let envKey = "";
    try {
      if (typeof import.meta !== 'undefined' && import.meta.env) {
        envKey = import.meta.env.VITE_GEMINI_API_KEY || "";
      }
    } catch (e) {}
    const sysKey = typeof apiKey !== 'undefined' ? apiKey : "";
    return envKey || sysKey || userSettings.geminiKey;
  };

  const saveSettings = async () => {
    if (!user || !db) return;
    setIsSettingsSaving(true);
    try {
      const settingsRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'settings', 'config');
      await setDoc(settingsRef, userSettings, { merge: true });
      setActiveTab('planner');
    } catch (err) { setError("설정 저장 실패"); } finally { setIsSettingsSaving(false); }
  };

  const fetchWithRetry = async (url, options, retries = 5, backoff = 1000) => {
    try {
      const response = await fetch(url, options);
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      return await response.json();
    } catch (err) {
      if (retries > 0) {
        await new Promise(r => setTimeout(r, backoff));
        return fetchWithRetry(url, options, retries - 1, backoff * 2);
      }
      throw err;
    }
  };

  const generateWeeklyPlan = async () => {
    const key = getActiveKey();
    if (!key) { setError("설정 탭에서 API 키를 먼저 입력해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    const pastMenus = history.slice(0, 2).map(h => JSON.stringify(h.plan)).join('\n');
    const systemPrompt = `지현이를 위한 식단 AI입니다. 최근 이력(${pastMenus})과 겹치지 않게 병원 식단표 패턴으로 이번 주 식단을 JSON으로 짜주세요. { "days": [ { "date": "월", "breakfast": [...], "lunch": [...], "dinner": [...], "snack": "" } ] }`;
    try {
      const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "지현이를 위해 새로운 병원 주간 식단을 생성해줘." }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) {
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'meal_history'), {
          plan: data.days, createdAt: serverTimestamp(), userId: user.uid
        });
      }
    } catch (err) { setError("식단 생성 오류"); } finally { setLoading(false); }
  };

  const searchRecipe = async (e) => {
    if (e) e.preventDefault();
    const key = getActiveKey();
    if (!searchQuery || !key) { if (!key) setActiveTab('settings'); return; }
    setLoading(true); setError(null); setRecipeData(null); setRecipeImage(null);
    fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: { prompt: `Professional food photography of ${searchQuery}, minimalist, 4k.` }, parameters: { sampleCount: 1 } })
    }).then(res => { if (res.predictions?.[0]) setRecipeImage(`data:image/png;base64,${res.predictions[0].bytesBase64Encoded}`); }).catch(() => {});
    try {
      const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${searchQuery} 레시피 알려줘.` }] }],
          systemInstruction: { parts: [{ text: `JSON: { "title":"", "intro":"", "time":"", "difficulty":"", "servings":"", "ingredients":[{"item":"", "amount":""}], "steps":[""], "nutrition_tip":"" }` }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      setRecipeData(JSON.parse(result.candidates[0].content.parts[0].text));
    } catch (err) { setError("레시피 검색 오류"); } finally { setLoading(false); }
  };

  const copyRecipe = () => {
    if (!recipeData) return;
    const text = `${recipeData.title} 레시피\n\n[재료]\n${recipeData.ingredients.map(i => `- ${i.item}: ${i.amount}`).join('\n')}\n\n[조리 순서]\n${recipeData.steps.map((s, i) => `${i+1}. ${s}`).join('\n')}`;
    const textArea = document.createElement("textarea");
    textArea.value = text;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 pb-20">
      <nav className="bg-white border-b sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-rose-500 p-1.5 rounded-lg shadow-md"><Heart className="text-white w-4 h-4" /></div>
            <h1 className="text-lg font-black tracking-tight text-slate-800">사랑하는 지현이의 <span className="text-rose-500">영양 매니저</span></h1>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
            <button onClick={() => setActiveTab('planner')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'planner' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>식단</button>
            <button onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'history' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>히스토리</button>
            <button onClick={() => setActiveTab('recipe')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'recipe' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>레시피</button>
            <button onClick={() => setActiveTab('settings')} className={`p-1.5 rounded-lg transition-all ${activeTab === 'settings' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}><Settings size={18}/></button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-xl flex items-center gap-2 text-sm font-bold animate-in fade-in"><AlertCircle size={16}/> {error}</div>}

        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-end bg-white p-8 rounded-[2rem] shadow-xl border border-rose-100 gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-800">병원 주간 식단 만들기</h2>
                <p className="text-rose-400 text-sm font-bold mt-1 uppercase tracking-wider italic">Jihyun's Kitchen AI 🎁</p>
              </div>
              <button onClick={generateWeeklyPlan} disabled={loading} className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-rose-200 transition-all active:scale-95 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={20} /> : <RefreshCw size={20} />} AI 식단 생성
              </button>
            </div>
            {weeklyPlan ? (
              <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b text-center">
                    <tr>
                      <th className="p-5 w-20 border-r text-slate-400 font-black">구분</th>
                      {weeklyPlan.map((day, i) => <th key={i} className={`p-5 border-r last:border-r-0 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-rose-500' : 'text-slate-700'} font-black text-sm`}>{day.date}요일</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {['breakfast', 'lunch', 'dinner'].map(m => (
                      <tr key={m} className="hover:bg-rose-50/10 transition-colors text-center">
                        <td className="p-5 font-black bg-slate-50/30 text-slate-400 border-r uppercase">{m === 'breakfast' ? '조식' : m === 'lunch' ? '중식' : '석식'}</td>
                        {weeklyPlan.map((day, i) => (
                          <td key={i} className="p-5 border-r last:border-r-0 align-top">
                            <ul className="space-y-1.5 text-left">
                              {day[m].map((item, idx) => (
                                <li key={idx} className={`flex items-start gap-1.5 ${m === 'lunch' ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                                  <div className="w-1 h-1 rounded-full bg-rose-300 mt-1.5 shrink-0" />
                                  <span>{item}</span>
                                </li>
                              ))}
                            </ul>
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-80 bg-white border-2 border-dashed border-slate-200 rounded-[2rem] flex flex-col items-center justify-center text-slate-400 gap-3">
                <Calendar size={48} className="opacity-20 text-rose-300" />
                <p className="font-bold">아직 생성된 주간 식단표가 없습니다.</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
           <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-right-4 duration-500">
             {history.map((h, i) => (
               <div key={h.id} className="bg-white p-6 rounded-[2rem] shadow-lg border border-slate-100 hover:border-rose-300 transition-all group">
                 <div className="flex justify-between items-start mb-4 text-[10px]">
                   <p className="font-black text-rose-500 uppercase tracking-widest">{i === 0 ? "최근 식단" : `${i+1}주 전`}</p>
                   <p className="text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : '...'}</p>
                 </div>
                 <div className="space-y-2 mb-6 px-1 text-xs font-bold text-slate-700 truncate">
                    <p>🥗 월 점심: {h.plan[0].lunch[0]}</p>
                    <p>🥘 수 점심: {h.plan[2].lunch[0]}</p>
                 </div>
                 <button onClick={() => {setWeeklyPlan(h.plan); setActiveTab('planner'); window.scrollTo(0,0);}} className="w-full py-3 bg-slate-50 group-hover:bg-rose-500 group-hover:text-white text-slate-500 rounded-xl text-xs font-black transition-all">식단표 불러오기</button>
               </div>
             ))}
             {history.length === 0 && <div className="col-span-full py-20 text-center text-slate-400 font-bold">저장된 히스토리가 없습니다.</div>}
           </div>
        )}

        {activeTab === 'recipe' && (
          <div className="max-w-5xl mx-auto space-y-10 animate-in slide-in-from-bottom-4 duration-500">
            <section className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100 flex flex-col items-center">
              <h3 className="text-xl font-black text-slate-800 mb-6">지현이를 위한 레시피 연구소</h3>
              <form onSubmit={searchRecipe} className="flex gap-3 w-full max-w-2xl">
                <input type="text" value={searchQuery} onChange={(e)=>setSearchQuery(e.target.value)} placeholder="메뉴를 검색하세요..." className="flex-1 px-6 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-rose-500 font-bold" />
                <button disabled={loading} className="bg-rose-500 text-white px-8 rounded-2xl font-black shadow-lg shadow-rose-200">{loading ? <Loader2 className="animate-spin" /> : "검색"}</button>
              </form>
            </section>
            {recipeData && (
              <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start animate-in fade-in duration-700">
                <div className="md:col-span-4 space-y-6">
                  <div className="bg-white p-4 rounded-[2.5rem] shadow-xl border border-slate-100 overflow-hidden">
                    {recipeImage ? <img src={recipeImage} className="rounded-3xl w-full aspect-square object-cover mb-4 shadow-inner" alt={recipeData.title} /> : <div className="aspect-square bg-slate-50 rounded-3xl flex items-center justify-center text-slate-200"><Utensils size={48}/></div>}
                    <h3 className="text-2xl font-black px-2">{recipeData.title}</h3>
                    <p className="text-sm text-slate-500 p-2 font-bold leading-relaxed">{recipeData.intro}</p>
                    <div className="grid grid-cols-3 gap-2 mt-4 p-2 text-center text-[10px] font-bold">
                        <div className="bg-slate-50 p-2 rounded-xl text-rose-400">{recipeData.time}</div>
                        <div className="bg-slate-50 p-2 rounded-xl text-orange-400">{recipeData.difficulty}</div>
                        <div className="bg-slate-50 p-2 rounded-xl text-blue-400">{recipeData.servings}</div>
                    </div>
                  </div>
                  {recipeData.nutrition_tip && (
                    <div className="bg-slate-900 text-white p-8 rounded-[2.5rem] shadow-2xl relative overflow-hidden group">
                      <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:scale-110 transition-transform"><Info size={40} /></div>
                      <h4 className="text-[10px] font-black text-rose-400 uppercase tracking-[0.3em] mb-3">Professional Tip</h4>
                      <p className="text-sm font-bold leading-relaxed italic text-slate-200">"{recipeData.nutrition_tip}"</p>
                    </div>
                  )}
                </div>
                <div className="md:col-span-8 bg-white p-10 rounded-[2.5rem] shadow-2xl border border-slate-100">
                   <div className="mb-10"><h4 className="font-black text-rose-500 text-xs mb-4 uppercase tracking-widest flex items-center gap-2"><ListChecks size={16}/> 필수 재료</h4>
                   <div className="grid grid-cols-2 gap-4 border-t pt-6 text-sm">
                     {recipeData.ingredients.map((ing, idx) => (
                       <div key={idx} className="flex justify-between border-b border-slate-50 pb-2"><span className="text-slate-600 font-bold">{ing.item}</span><span className="font-black text-rose-500">{ing.amount}</span></div>
                     ))}
                   </div></div>
                   <div><h4 className="font-black text-rose-500 text-xs mb-4 uppercase tracking-widest flex items-center gap-2"><ChefHat size={16}/> 조리 가이드</h4>
                   <div className="space-y-6 border-t pt-6 text-sm font-bold">
                     {recipeData.steps.map((s, i) => (
                       <div key={i} className="flex gap-4"><span className="shrink-0 w-8 h-8 rounded-full bg-slate-50 flex items-center justify-center text-xs text-slate-300 italic">{i+1}</span><p className="pt-1">{s}</p></div>
                     ))}
                   </div></div>
                </div>
              </div>
            )}
            {loading && !recipeData && (
              <div className="flex flex-col items-center justify-center py-20 gap-4 text-slate-400 animate-in fade-in">
                <Loader2 className="animate-spin w-12 h-12 text-rose-400" />
                <p className="font-bold animate-pulse">AI가 레시피와 이미지를 연구하고 있습니다...</p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto space-y-8 animate-in zoom-in duration-300">
            <div className="bg-white p-10 rounded-[2.5rem] shadow-xl border border-rose-100">
              <div className="flex items-center gap-3 mb-8">
                <div className="bg-rose-50 p-3 rounded-2xl"><Key className="text-rose-500" /></div>
                <div>
                  <h3 className="text-2xl font-black text-slate-800">앱 설정</h3>
                  <p className="text-slate-400 text-sm font-bold">AI 기능을 위한 개인 키를 관리합니다.</p>
                </div>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-black text-slate-700 mb-2 px-1 uppercase tracking-widest">Gemini API Key</label>
                  <input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="AI Studio에서 받은 API 키를 입력하세요" className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-rose-500 font-bold transition-all" />
                  <p className="mt-2 text-xs text-slate-400 px-2 leading-relaxed">* 이 키는 지현님의 개인 공간에 안전하게 저장됩니다.</p>
                </div>
                <button onClick={saveSettings} disabled={isSettingsSaving} className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black shadow-lg transition-all flex items-center justify-center gap-2">
                  {isSettingsSaving ? <Loader2 className="animate-spin" /> : <Save size={20}/>} 설정 저장하기
                </button>
              </div>
            </div>
            <div className="bg-rose-50 p-6 rounded-[2rem] border border-rose-100 font-bold text-[11px] text-rose-700/70 space-y-1">
              <p>• API 키를 저장하면 식단 생성과 레시피 검색 기능이 활성화됩니다.</p>
              <p>• 키는 Google AI Studio(aistudio.google.com)에서 발급받을 수 있습니다.</p>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-10 py-10 text-center opacity-20">
        <p className="text-slate-400 text-[9px] font-black uppercase tracking-[0.5em]">For Jihyun with Love</p>
      </footer>
    </div>
  );
};

export default App;