import React, { useState, useEffect } from 'react';
import { Calendar, ChefHat, RefreshCw, Loader2, Key, Save, Download, Heart, Info, AlertCircle } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// --- 환경 변수 관리 (Rule 1 & Global Variables) ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const APP_ID = typeof __app_id !== 'undefined' ? __app_id : 'jihyun-hospital-app';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase 초기화
let app, auth, db;
if (firebaseConfig) {
  app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
}

const App = () => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(false);
  const [weeklyPlan, setWeeklyPlan] = useState(null);
  const [history, setHistory] = useState([]);
  const [activeTab, setActiveTab] = useState('planner');
  const [userSettings, setUserSettings] = useState({ geminiKey: "" });
  const [error, setError] = useState(null);

  // 1. 인증 로직 (Rule 3 준수: Auth First)
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
      }
    };

    initAuth();
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  // 2. 데이터 리스너 (Rule 1 & 3 준수: Guard with user check)
  useEffect(() => {
    // 사용자가 인증될 때까지 기다림 (Permission Denied 방지 핵심)
    if (!user || !db) return;

    // 히스토리 리스너 (Rule 1 경로)
    const historyRef = collection(db, 'artifacts', APP_ID, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      // 클라이언트 측 정렬 (Rule 2)
      setHistory(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => {
      console.error("Firestore history listener error:", err);
    });

    // 개인 설정 리스너 (Rule 1 경로)
    const settingsRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) {
        setUserSettings(docSnap.data());
      }
    }, (err) => {
      console.error("Firestore settings listener error:", err);
    });

    return () => {
      unsubHistory();
      unsubSettings();
    };
  }, [user]);

  const getActiveKey = () => {
    let envKey = "";
    try { 
      if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) {
        envKey = import.meta.env.VITE_GEMINI_API_KEY;
      }
    } catch(e) {}
    return envKey || userSettings.geminiKey || (typeof apiKey !== 'undefined' ? apiKey : "");
  };

  const generateWeeklyPlan = async () => {
    const key = getActiveKey();
    if (!key) { 
      setError("설정 탭에서 API 키를 먼저 입력해 주세요."); 
      setActiveTab('settings'); 
      return; 
    }
    if (!user) return;

    setLoading(true); 
    setError(null);

    const systemPrompt = `당신은 병원 영양사 지현이를 돕는 AI입니다. 병원 식단표 양식에 맞춰 JSON을 생성하세요.
    - 7일분 (월~일)
    - 아침, 점심, 저녁 각각 5개 메뉴 리스트
    - 간식은 저녁 뒤 1개 메뉴
    - 결과 형식: { "days": [ { "date": "1/12(월)", "breakfast": ["쌀밥", "미역국", "불고기", "숙주나물", "포기김치"], "lunch": [...], "dinner": [...], "snack": "사과주스" } ] }`;

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
      
      if (db && user) {
        // Rule 1 경로 준수
        await addDoc(collection(db, 'artifacts', APP_ID, 'public', 'data', 'meal_history'), { 
          plan: data.days, 
          createdAt: serverTimestamp(),
          userId: user.uid 
        });
      }
    } catch (err) { 
      setError("식단 생성에 실패했습니다. API 키를 확인해 주세요."); 
    } finally { 
      setLoading(false); 
    }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center py-2 min-h-[120px] leading-tight">
      {items.map((item, i) => (
        <span key={i} className={`text-[11px] md:text-[12px] ${isLunch && i === 2 ? 'font-black text-blue-700' : 'text-slate-800'}`}>
          {item}
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f3f4f6] p-2 md:p-6">
      {/* 상단 헤더 */}
      <div className="max-w-[1200px] mx-auto mb-6 flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-200">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-2xl shadow-lg"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight">지현이를 위한 <span className="text-blue-600">병원 식단 매니저</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Premium Hospital Meal Grid System</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1 rounded-2xl">
          {['planner', 'history', 'settings'].map(t => (
            <button 
              key={t} 
              onClick={() => setActiveTab(t)} 
              className={`px-6 py-2 rounded-xl text-xs font-black transition-all ${activeTab === t ? 'bg-white text-blue-600 shadow-sm' : 'text-slate-500'}`}
            >
              {t === 'planner' ? '식단표' : t === 'history' ? '히스토리' : '설정'}
            </button>
          ))}
        </div>
      </div>

      <main className="max-w-[1200px] mx-auto">
        {error && (
          <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold flex items-center gap-2 animate-in fade-in">
            <AlertCircle size={16}/> {error}
          </div>
        )}

        {activeTab === 'planner' && (
          <div className="space-y-4 animate-in fade-in duration-500">
            <div className="flex justify-between items-center px-2">
              <h2 className="text-lg font-black text-slate-700 flex items-center gap-2">
                <Calendar className="text-blue-600" size={20}/> 신도시이진병원 주간 식단표
              </h2>
              <button 
                onClick={generateWeeklyPlan} 
                disabled={loading || !user} 
                className="bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-black text-xs shadow-lg transition-all flex items-center gap-2 disabled:opacity-50"
              >
                {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} AI 자동 식단 생성
              </button>
            </div>

            {!user ? (
              <div className="bg-white p-20 rounded-[3rem] text-center text-slate-400 font-bold">
                <Loader2 className="animate-spin mx-auto mb-2" />
                사용자 인증 중...
              </div>
            ) : weeklyPlan ? (
              <div className="bg-white border-2 border-slate-300 shadow-2xl overflow-x-auto rounded-sm">
                <table className="w-full min-w-[800px] border-collapse text-center">
                  <thead>
                    <tr className="bg-slate-100 border-b-2 border-slate-300">
                      <th className="w-20 p-3 border-r-2 border-slate-200 text-xs font-black text-slate-400">구분</th>
                      {weeklyPlan.map((day, i) => (
                        <th key={i} className={`p-3 border-r-2 border-slate-200 last:border-r-0 text-[13px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>
                          {day.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">아침<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/50">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic">죽</td>
                      <td colSpan="7" className="p-1 text-[11px] font-bold text-blue-700 tracking-widest bg-blue-50/30">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">점심<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}
                    </tr>
                    <tr className="bg-blue-50/50">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-blue-400 italic">죽</td>
                      <td colSpan="7" className="p-1 text-[11px] font-bold text-blue-700 tracking-widest bg-blue-50/30">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    <tr>
                      <td className="bg-slate-50 border-r-2 border-slate-200 font-black text-[11px] text-slate-400">저녁<br/>차림</td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-2 border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}
                    </tr>
                    <tr className="bg-rose-50/40">
                      <td className="border-r-2 border-slate-200 font-bold text-[10px] text-rose-400 italic">간식</td>
                      {weeklyPlan.map((day, i) => (
                        <td key={i} className="p-3 border-r-2 border-slate-200 last:border-r-0 text-[11px] font-black text-rose-600 italic">
                          {day.snack || "과일쥬스"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-white p-20 rounded-[3rem] border-4 border-dashed border-slate-200 text-center space-y-4 animate-in zoom-in-95 duration-700">
                <div className="bg-slate-50 w-20 h-20 rounded-full flex items-center justify-center mx-auto shadow-inner">
                  <ChefHat size={40} className="text-slate-200" />
                </div>
                <p className="font-black text-slate-400 text-lg">아직 생성된 식단표가 없습니다.<br/><span className="text-sm font-bold opacity-60 text-blue-500">오른쪽 상단 버튼을 눌러보세요!</span></p>
              </div>
            )}
          </div>
        )}

        {activeTab === 'history' && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 animate-in slide-in-from-right-4 duration-500">
            {history.map((h, i) => (
              <div key={h.id} className="bg-white p-6 rounded-[2rem] shadow-lg border border-slate-200 hover:border-blue-400 transition-all group">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-3 py-1 rounded-full uppercase tracking-widest">{i === 0 ? "최근 기록" : `${i+1}번째 기록`}</span>
                  <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : '...'}</span>
                </div>
                <div className="space-y-2 mb-6 text-xs font-bold text-slate-700">
                   <p>🥘 월 점심: {h.plan[0].lunch[0]}</p>
                   <p>🥗 수 점심: {h.plan[2].lunch[0]}</p>
                </div>
                <button onClick={() => {setWeeklyPlan(h.plan); setActiveTab('planner');}} className="w-full py-3 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-xl text-xs font-black transition-all shadow-sm active:scale-95">식단표 불러오기</button>
              </div>
            ))}
            {history.length === 0 && <div className="col-span-full py-20 text-center text-slate-400 font-bold animate-pulse">기록이 없습니다.</div>}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="max-w-xl mx-auto animate-in zoom-in duration-300">
            <div className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-rose-100">
              <div className="flex items-center gap-3 mb-8">
                <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" size={20}/></div>
                <div><h3 className="text-xl font-black text-slate-800 tracking-tight">서비스 설정</h3><p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">System Configuration</p></div>
              </div>
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black text-slate-400 mb-2 uppercase tracking-widest px-1">Gemini API Key</label>
                  <input 
                    type="password" 
                    value={userSettings.geminiKey} 
                    onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} 
                    placeholder="AI Studio에서 받은 키를 입력하세요" 
                    className="w-full px-6 py-4 rounded-2xl bg-slate-50 border-none focus:ring-2 focus:ring-blue-500 font-bold transition-all shadow-inner outline-none" 
                  />
                </div>
                <button 
                  onClick={async () => {
                    if (!user || !db) return;
                    try {
                      const settingsRef = doc(db, 'artifacts', APP_ID, 'users', user.uid, 'settings', 'config');
                      await setDoc(settingsRef, userSettings, { merge: true });
                      setActiveTab('planner');
                    } catch (err) {
                      setError("설정 저장에 실패했습니다.");
                    }
                  }} 
                  className="w-full py-4 bg-slate-900 hover:bg-black text-white rounded-2xl font-black shadow-lg transition-all active:scale-95 disabled:opacity-50" 
                  disabled={!user}
                >
                  설정 저장하기
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      <footer className="mt-10 py-10 text-center opacity-30 text-[10px] font-black uppercase tracking-[0.5em] text-slate-400">
        Made for Jihyun by Her Loving Husband
      </footer>
    </div>
  );
};

export default App;