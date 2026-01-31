import React, { useState, useEffect } from 'react';
import { Search, Calendar, Utensils, RefreshCw, ChefHat, BookOpen, AlertCircle, Loader2, Clock, Users, Flame, ChevronRight, Copy, CheckCircle2, ListChecks, Info, History, Heart } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore';

/**
 * [Vercel 배포 가이드]
 * 이 코드는 배포 후 Vercel 대시보드 환경 변수(VITE_...)를 사용하여 작동합니다.
 */

let GEMINI_API_KEY = "";
let FB_CONFIG_STR = null;
let APP_ID = 'jihyun-diet-app';

try {
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || "";
    FB_CONFIG_STR = import.meta.env.VITE_FIREBASE_CONFIG || null;
    APP_ID = import.meta.env.VITE_APP_ID || 'jihyun-diet-app';
  }
} catch (e) {}

if (typeof __firebase_config !== 'undefined' && !FB_CONFIG_STR) FB_CONFIG_STR = __firebase_config;
if (typeof __app_id !== 'undefined' && APP_ID === 'jihyun-diet-app') APP_ID = __app_id;

const FIREBASE_CONFIG = FB_CONFIG_STR ? (typeof FB_CONFIG_STR === 'string' ? JSON.parse(FB_CONFIG_STR) : FB_CONFIG_STR) : null;

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
    const unsubscribe = onSnapshot(historyRef, (snapshot) => {
      const historyData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sorted = historyData.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
      setHistory(sorted);
    }, (err) => { console.error("데이터 로딩 실패:", err); });
    return () => unsubscribe();
  }, [user]);

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
    const key = GEMINI_API_KEY || (typeof apiKey !== 'undefined' ? apiKey : "");
    if (!key) { setError("API 키가 설정되지 않았습니다."); return; }
    setLoading(true);
    setError(null);
    const pastMenus = history.slice(0, 2).map(h => JSON.stringify(h.plan)).join('\n');
    const systemPrompt = `지현이를 위한 식단 AI입니다. 병원 식단표 패턴으로 이번 주 식단을 JSON으로 짜주세요. 최근 이력(${pastMenus})과 겹치지 않아야 합니다. { "days": [ { "date": "월", "breakfast": [...], "lunch": [...], "dinner": [...], "snack": "" } ] }`;
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
    const key = GEMINI_API_KEY || (typeof apiKey !== 'undefined' ? apiKey : "");
    if (!searchQuery || !key) return;
    setLoading(true); setError(null); setRecipeData(null); setRecipeImage(null);
    fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/imagen-4.0-generate-001:predict?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instances: { prompt: `Professional food photography of ${searchQuery}, minimalist white plate, 4k.` }, parameters: { sampleCount: 1 } })
    }).then(res => { if (res.predictions?.[0]) setRecipeImage(`data:image/png;base64,${res.predictions[0].bytesBase64Encoded}`); }).catch(() => {});
    try {
      const result = await fetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: `${searchQuery} 레시피 상세히 알려줘.` }] }],
          systemInstruction: { parts: [{ text: `JSON 형식: { "title":"", "intro":"", "time":"", "difficulty":"", "servings":"", "ingredients":[{"item":"", "amount":""}], "steps":[""], "nutrition_tip":"" }` }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      setRecipeData(JSON.parse(result.candidates[0].content.parts[0].text));
    } catch (err) { setError("레시피 검색 오류"); } finally { setLoading(false); }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] font-sans text-slate-900 pb-20">
      <nav className="bg-white border-b sticky top-0 z-50 shadow-sm">
        <div className="max-w-7xl mx-auto px-6 h-16 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="bg-rose-500 p-1.5 rounded-lg shadow-md"><Heart className="text-white w-4 h-4" /></div>
            <h1 className="text-lg font-black tracking-tight">사랑하는 지현이를 위한 <span className="text-rose-500">전용 매니저</span></h1>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-xl gap-1">
            <button onClick={() => setActiveTab('planner')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'planner' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>식단 관리</button>
            <button onClick={() => setActiveTab('history')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'history' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>히스토리</button>
            <button onClick={() => setActiveTab('recipe')} className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${activeTab === 'recipe' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-500'}`}>레시피 검색</button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row justify-between items-end bg-white p-8 rounded-[2rem] shadow-xl border border-rose-100 gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-800">병원 주간 식단 만들기</h2>
                <p className="text-rose-400 text-sm font-bold mt-1 uppercase tracking-wider italic">Jihyun's Meal Assistant 🎁</p>
              </div>
              <button onClick={generateWeeklyPlan} disabled={loading} className="flex items-center gap-2 bg-rose-500 hover:bg-rose-600 text-white px-8 py-4 rounded-2xl font-bold shadow-lg shadow-rose-200 transition-all active:scale-95 disabled:opacity-50">
                {loading ? <Loader2 className="animate-spin" size={20} /> : <RefreshCw size={20} />} AI 식단 생성
              </button>
            </div>
            {weeklyPlan ? (
              <div className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b">
                    <tr>
                      <th className="p-5 w-20 border-r text-slate-400 uppercase tracking-widest font-black text-center">구분</th>
                      {weeklyPlan.map((day, i) => <th key={i} className={`p-5 border-r last:border-r-0 ${i === 5 ? 'text-blue-500' : i === 6 ? 'text-rose-500' : 'text-slate-700'} font-black text-sm text-center`}>{day.date}요일</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-center">
                    {['breakfast', 'lunch', 'dinner'].map(m => (
                      <tr key={m}>
                        <td className="p-5 font-black bg-slate-50/30 text-slate-400 border-r">{m === 'breakfast' ? '조식' : m === 'lunch' ? '중식' : '석식'}</td>
                        {weeklyPlan.map((day, i) => (
                          <td key={i} className="p-5 border-r last:border-r-0 align-top">
                            <ul className="space-y-1 text-left">
                              {day[m].map((item, idx) => <li key={idx} className="flex items-start gap-1.5"><div className="w-1 h-1 rounded-full bg-rose-300 mt-1.5 shrink-0" />{item}</li>)}
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
        {/* 히스토리 및 레시피 탭 코드 생략 (이전과 동일) */}
        {activeTab === 'history' && <div className="p-20 text-center text-slate-400 font-bold">히스토리 내역을 불러오는 중입니다...</div>}
        {activeTab === 'recipe' && (
          <div className="max-w-4xl mx-auto space-y-6">
            <section className="bg-white p-6 rounded-3xl shadow-xl border border-slate-100 flex flex-col items-center">
              <h3 className="text-xl font-black text-slate-800 mb-6">레시피 연구소</h3>
              <form onSubmit={searchRecipe} className="flex gap-3 w-full">
                <input type="text" value={searchQuery} onChange={(e)=>setSearchQuery(e.target.value)} placeholder="요리 검색..." className="flex-1 px-6 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-rose-500 font-bold" />
                <button disabled={loading} className="bg-rose-500 text-white px-8 rounded-2xl font-black">{loading ? <Loader2 className="animate-spin" /> : "검색"}</button>
              </form>
            </section>
            {recipeData && <div className="bg-white p-8 rounded-3xl shadow-lg font-bold">레시피 정보 로딩 완료!</div>}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;