import React, { useState, useEffect } from 'react';
import { Search, Calendar, Utensils, RefreshCw, ChefHat, AlertCircle, Loader2, Clock, Users, Flame, ChevronRight, Copy, CheckCircle2, ListChecks, Info, History, Heart, Settings, Key, Save, Download } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore';

// --- 환경 변수 관리 (Vercel & Canvas 공용) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'jihyun-hospital-app';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase 초기화 (컴포넌트 외부에서 수행)
let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [recipeData, setRecipeData] = useState(null);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [error, setError] = useState(null);
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });

  // 1. 인증 로직 (Rule 3 준수: Auth First & Await)
  useEffect(() => {
    if (!auth) return;

    const initAuth = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) {
        console.error("인증 실패:", err);
        setError("사용자 인증에 실패했습니다.");
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 2. 데이터 fetching (Rule 1 & 3 준수: Guard with user check)
  useEffect(() => {
    // 로그인이 완료되기 전에는 쿼리를 시도하지 않음 (Permission Denied 방지)
    if (!user || !db) return;

    // 히스토리 리스너 (Rule 1 경로 준수)
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 클라이언트 측에서 정렬 (Rule 2 준수)
      setHistory(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => {
      console.error("히스토리 로딩 실패:", err);
    });

    // 설정 리스너 (Rule 1 개인 경로 준수)
    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserSettings(docSnap.data());
      }
    }, (err) => {
      console.error("설정 로딩 실패:", err);
    });

    return () => {
      unsubHistory();
      unsubSettings();
    };
  }, [user]);

  const getActiveKey = () => {
    try { 
      // Vercel 환경 변수 체크
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
        return import.meta.env.VITE_GEMINI_API_KEY;
      }
    } catch(e) {}
    // 저장된 키 또는 Canvas 기본 키 반환
    return userSettings.geminiKey || (typeof apiKey !== 'undefined' ? apiKey : "");
  };

  const generateWeeklyPlan = async () => {
    const key = getActiveKey();
    if (!key) { 
      setError("설정 탭에서 Gemini API 키를 먼저 입력해 주세요."); 
      setActiveTab('settings'); 
      return; 
    }
    if (!user) return;

    setLoading(true); 
    setError(null);

    const systemPrompt = `당신은 병원 영양사 지현이를 돕는 AI입니다. 병원 식단표 양식에 맞춰 JSON을 생성하세요.
    - 구성: 월요일~일요일 (7일)
    - 각 날짜별 항목: 아침(차림 5개), 점심(차림 5개), 저녁(차림 5개), 죽(공통), 간식(저녁후)
    - 결과 형식: { "days": [ { "date": "1/12(월)", "breakfast": ["쌀밥", "국", "반찬1", "반찬2", "김/우유"], "lunch": [...], "dinner": [...], "porridge": "쇠고기야채죽/흰죽", "snack": "주스" } ] }`;

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-09-2025:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "병원 식단표 양식으로 이번주 식단을 짜줘." }] }],
          systemInstruction: { parts: [{ text: systemPrompt }] },
          generationConfig: { responseMimeType: "application/json" }
        })
      });
      
      if (!res.ok) throw new Error("API 요청 실패");
      
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      
      // Firestore에 저장 (Rule 1)
      if (db && user) {
        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { 
          plan: data.days, 
          createdAt: serverTimestamp(),
          creatorId: user.uid 
        });
      }
    } catch (err) { 
      setError("식단 생성에 실패했습니다. API 키를 확인해 주세요."); 
    } finally { 
      setLoading(false); 
    }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center space-y-0.5 py-1 px-0.5 min-h-[100px]">
      {items.map((item, i) => (
        <span key={i} className={`text-[11px] leading-tight text-center ${isLunch && i === 2 ? 'font-bold text-blue-700' : 'text-slate-800'}`}>
          {item}
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-100 font-sans text-slate-900 pb-20">
      <nav className="bg-white border-b sticky top-0 z-50 shadow-sm px-6 py-4">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <div className="bg-blue-600 p-2 rounded-xl shadow-lg"><ChefHat className="text-white w-6 h-6" /></div>
            <div>
              <h1 className="text-xl font-black text-slate-800 tracking-tight">사랑하는 지현이의 <span className="text-blue-600 font-black">영양 매니저</span></h1>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Premium Hospital Meal System</p>
            </div>
          </div>
          <div className="flex bg-slate-100 p-1 rounded-2xl gap-1">
            {['planner', 'history', 'recipe', 'settings'].map(tab => (
              <button key={tab} onClick={() => setActiveTab(tab)} className={`px-5 py-2 rounded-xl text-xs font-black transition-all ${activeTab === tab ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-700'}`}>
                {tab === 'planner' ? '식단표' : tab === 'history' ? '히스토리' : tab === 'recipe' ? '레시피' : '설정'}
              </button>
            ))}
          </div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto px-4 py-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-600 rounded-2xl flex items-center gap-2 text-sm font-bold animate-in fade-in">
            <AlertCircle size={18}/> {error}
          </div>
        )}

        {activeTab === 'planner' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center bg-white p-6 rounded-3xl border border-slate-200 shadow-sm">
              <div>
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">
                  <Calendar className="text-blue-600" /> 신도시이진병원 주간 식단
                </h2>
                <p className="text-slate-400 text-xs font-bold mt-1 uppercase italic">오늘도 고생하는 지현이를 위한 AI 조력자</p>
              </div>
              <div className="flex gap-2">
                <button onClick={generateWeeklyPlan} disabled={loading || !user} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black transition-all shadow-lg active:scale-95 disabled:opacity-50">
                  {loading ? <Loader2 className="animate-spin" /> : <RefreshCw size={18} />} 식단 자동 생성
                </button>
                {weeklyPlan && <button className="p-3 bg-white border border-slate-200 rounded-2xl text-slate-500 hover:text-blue-600 transition-colors shadow-sm"><Download size={20}/></button>}
              </div>
            </div>

            {!user ? (
              <div className="py-20 text-center text-slate-400">
                <Loader2 className="animate-spin mx-auto mb-4" />
                <p className="font-bold">시스템 접속 중입니다...</p>
              </div>
            ) : weeklyPlan ? (
              <div className="bg-white border-2 border-slate-300 shadow-2xl rounded-sm overflow-hidden animate-in zoom-in-95 duration-500">
                <table className="w-full table-fixed border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b-2 border-slate-300">
                      <th className="w-16 p-3 border-r-2 border-slate-200 text-xs font-black text-slate-400">구분</th>
                      {weeklyPlan.map((day, i) => (
                        <th key={i} className={`p-3 border-r-2 border-slate-200 last:border-r-0 text-sm font-black text-center ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>
                          {day.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="bg-slate-50 border-b-2 border-r-2 border-slate-200 text-[11px] font-black text-slate-400 text-center uppercase tracking-tighter">아침<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-b-2 border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/30">
                      <td className="border-b-2 border-r-2 border-slate-200 text-[10px] font-bold text-blue-400 text-center italic">죽</td>
                      <td colSpan="7" className="p-1 text-center border-b-2 border-slate-200 text-[11px] font-bold text-blue-600 tracking-wide">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-b-2 border-r-2 border-slate-200 text-[11px] font-black text-slate-400 text-center uppercase tracking-tighter">점심<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-b-2 border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/30">
                      <td className="border-b-2 border-r-2 border-slate-200 text-[10px] font-bold text-blue-400 text-center italic">죽</td>
                      <td colSpan="7" className="p-1 text-center border-b-2 border-slate-200 text-[11px] font-bold text-blue-600 tracking-wide">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-b-2 border-r-2 border-slate-200 text-[11px] font-black text-slate-400 text-center uppercase tracking-tighter">저녁<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-b-2 border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}
                    </tr>
                    <tr className="bg-rose-50/30">
                      <td className="border-r-2 border-slate-200 text-[10px] font-bold text-rose-400 text-center italic">간식</td>
                      {weeklyPlan.map((day, i) => (
                        <td key={i} className="p-2 border-r-2 border-slate-200 last:border-r-0 text-center text-[11px] font-black text-rose-600 italic">
                          {day.snack || "주스/케익"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="h-96 bg-white border-4 border-dashed border-slate-200 rounded-[3rem] flex flex-col items-center justify-center text-slate-300 gap-4">
                <div className="bg-slate-50 p-8 rounded-full shadow-inner"><Calendar size={80} strokeWidth={1} className="opacity-20" /></div>
                <div className="text-center">
                  <p className="font-black text-xl text-slate-500">식단표를 생성해 보세요.</p>
                  <p className="text-sm font-bold opacity-60">오른쪽 위 버튼을 누르면 AI가 지현님을 대신해 식단을 짭니다.</p>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-right-4 duration-500">
            {history.map((h, i) => (
              <div key={h.id} className="bg-white p-6 rounded-[2rem] shadow-lg border border-slate-200 hover:border-blue-300 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">{i === 0 ? "최신 기록" : `${i+1}번째 기록`}</span>
                  <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : '로딩 중...'}</span>
                </div>
                <div className="space-y-2 mb-6">
                  <p className="text-xs font-bold text-slate-700 truncate">🥗 {h.plan[0].lunch[0]}</p>
                  <p className="text-xs font-bold text-slate-700 truncate">🥘 {h.plan[2].lunch[0]}</p>
                </div>
                <button onClick={() => {setWeeklyPlan(h.plan); setActiveTab('planner');}} className="w-full py-3 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-xl text-xs font-black transition-all">식단표 불러오기</button>
              </div>
            ))}
            {history.length === 0 && <div className="col-span-full py-20 text-center text-slate-400 font-bold">저장된 히스토리가 없습니다.</div>}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-2xl mx-auto animate-in zoom-in duration-300">
            <div className="bg-white p-10 rounded-[3rem] shadow-xl border border-slate-200">
              <div className="flex items-center gap-4 mb-8">
                <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" /></div>
                <div><h3 className="text-2xl font-black text-slate-800 tracking-tight">서비스 설정</h3><p className="text-slate-400 text-sm font-bold uppercase">System Configuration</p></div>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="block text-xs font-black text-slate-400 mb-2 uppercase tracking-widest px-1">Gemini API Key</label>
                  <input 
                    type="password" 
                    value={userSettings.geminiKey} 
                    onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} 
                    placeholder="AI Studio에서 발급받은 키를 입력하세요" 
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-blue-500 font-bold transition-all shadow-inner" 
                  />
                </div>
                <button 
                  onClick={async () => {
                    if (!user) return;
                    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
                    await setDoc(settingsRef, userSettings);
                    setActiveTab('planner');
                  }} 
                  className="w-full py-5 bg-slate-900 hover:bg-black text-white rounded-2xl font-black shadow-lg transition-all active:scale-95 disabled:opacity-50"
                  disabled={!user}
                >
                  설정값 저장하기
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-20 py-10 text-center opacity-40">
        <p className="text-slate-400 text-[10px] font-black uppercase tracking-[0.5em]">Made for Jihyun by Her Loving Husband</p>
      </footer>
    </div>
  );
};

export default App;