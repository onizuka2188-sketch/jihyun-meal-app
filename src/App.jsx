import React, { useState, useEffect } from 'react';
import { Calendar, ChefHat, RefreshCw, Loader2, Key, Save, Download, Heart, Info, AlertCircle, Printer } from 'lucide-react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, onSnapshot, addDoc, setDoc, serverTimestamp } from 'firebase/firestore';

// --- 환경 변수 관리 ---
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : null;
const appId = typeof __app_id !== 'undefined' ? __app_id : 'jihyun-hospital-app';
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

  useEffect(() => {
    if (!auth) return;
    const initAuth = async () => {
      try {
        if (initialAuthToken) {
          await signInWithCustomToken(auth, initialAuthToken);
        } else {
          await signInAnonymously(auth);
        }
      } catch (err) { console.error("Auth failed:", err); }
    };
    initAuth();
    const unsubscribe = onAuthStateChanged(auth, setUser);
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !db) return;
    const historyRef = collection(db, 'artifacts', appId, 'public', 'data', 'meal_history');
    const unsubHistory = onSnapshot(historyRef, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setHistory(data.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)));
    }, (err) => { console.error("History error:", err); });

    const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
    const unsubSettings = onSnapshot(settingsRef, (docSnap) => {
      if (docSnap.exists()) setUserSettings(docSnap.data());
    }, (err) => { console.error("Settings error:", err); });

    return () => { unsubHistory(); unsubSettings(); };
  }, [user]);

  const getActiveKey = () => {
    try { if (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) return import.meta.env.VITE_GEMINI_API_KEY; } catch(e) {}
    return userSettings.geminiKey || (typeof apiKey !== 'undefined' ? apiKey : "");
  };

  const generateWeeklyPlan = async () => {
    const key = getActiveKey();
    if (!key) { setError("설정 탭에서 API 키를 먼저 입력해 주세요."); setActiveTab('settings'); return; }
    setLoading(true); setError(null);
    const systemPrompt = `당신은 전문 영양사입니다. 병원 주간 식단표 양식에 맞는 JSON 데이터를 생성하세요.
    - 7일분 (월~일)
    - 아침, 점심, 저녁 각각 5개 이상의 메뉴 리스트 (밥, 국, 메인반찬, 서브반찬, 김치/음료 등)
    - 간식은 저녁 뒤 1개 메뉴
    - 결과 형식: { "days": [ { "date": "1/12(월)", "breakfast": ["현미밥", "북어국", "계란말이", "시금치나물", "포기김치"], "lunch": [...], "dinner": [...], "snack": "사과주스" } ] }`;

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
      const result = await res.json();
      const data = JSON.parse(result.candidates[0].content.parts[0].text);
      setWeeklyPlan(data.days);
      if (db && user) await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meal_history'), { plan: data.days, createdAt: serverTimestamp(), userId: user.uid });
    } catch (err) { setError("식단 생성에 실패했습니다."); } finally { setLoading(false); }
  };

  const renderCell = (items, isLunch = false) => (
    <div className="flex flex-col items-center justify-center py-3 min-h-[130px] leading-[1.4]">
      {items.map((item, i) => (
        <span key={i} className={`text-[12px] md:text-[13px] tracking-tight ${isLunch && i === 2 ? 'font-black text-blue-700 underline' : 'text-slate-800 font-medium'}`}>
          {item}
        </span>
      ))}
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50 p-2 md:p-6 text-slate-900 print:bg-white print:p-0">
      {/* 상단 네비게이션 */}
      <nav className="max-w-[1200px] mx-auto mb-8 flex flex-col md:flex-row justify-between items-center gap-4 bg-white p-6 rounded-3xl shadow-sm border border-slate-200 print:hidden">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-3 rounded-2xl shadow-lg shadow-blue-100"><Heart className="text-white w-6 h-6 fill-current" /></div>
          <div>
            <h1 className="text-xl font-black text-slate-800 tracking-tight leading-none">사랑하는 지현이의 <span className="text-blue-600">영양 매니저</span></h1>
            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest mt-1">Hospital Dietary Information System</p>
          </div>
        </div>
        <div className="flex bg-slate-100 p-1.5 rounded-2xl gap-1">
          {['planner', 'history', 'settings'].map(t => (
            <button key={t} onClick={() => setActiveTab(t)} className={`px-8 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t ? 'bg-white text-blue-600 shadow-md' : 'text-slate-500 hover:text-slate-700'}`}>
              {t === 'planner' ? '식단표' : t === 'history' ? '히스토리' : '설정'}
            </button>
          ))}
        </div>
      </nav>

      <main className="max-w-[1200px] mx-auto">
        {error && <div className="mb-6 p-4 bg-red-50 text-red-600 rounded-2xl text-xs font-bold border border-red-100 flex items-center gap-2 print:hidden"><AlertCircle size={16}/> {error}</div>}

        {activeTab === 'planner' && (
          <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex justify-between items-end px-4 print:hidden">
              <div>
                <h2 className="text-2xl font-black text-slate-800 flex items-center gap-2">신도시이진병원 주간 식단표</h2>
                <p className="text-slate-400 text-xs font-bold mt-1 tracking-wide uppercase italic">Weekly Patient Meal Plan</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="bg-slate-800 hover:bg-black text-white px-5 py-3 rounded-2xl font-black text-xs transition-all active:scale-95 shadow-lg">인쇄/PDF 저장</button>
                <button onClick={generateWeeklyPlan} disabled={loading || !user} className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-2xl font-black text-xs shadow-lg shadow-blue-200 transition-all active:scale-95 disabled:opacity-50 flex items-center gap-2">
                  {loading ? <Loader2 className="animate-spin" size={16}/> : <RefreshCw size={16}/>} AI 자동 식단 생성
                </button>
              </div>
            </div>

            {weeklyPlan ? (
              <div className="bg-white border-[3px] border-slate-300 shadow-2xl overflow-x-auto rounded-lg print:border-slate-800">
                <table className="w-full min-w-[900px] border-collapse text-center table-fixed">
                  <thead>
                    <tr className="bg-slate-100 border-b-[3px] border-slate-300 print:bg-white print:border-b-2">
                      <th className="w-24 p-4 border-r-[3px] border-slate-200 text-xs font-black text-slate-500 uppercase tracking-widest">Meal Time</th>
                      {weeklyPlan.map((day, i) => (
                        <th key={i} className={`p-4 border-r-[3px] border-slate-200 last:border-r-0 text-[14px] font-black ${i === 5 ? 'text-blue-600' : i === 6 ? 'text-red-600' : 'text-slate-800'}`}>
                          {day.date}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y-2 divide-slate-200">
                    {/* 아침 */}
                    <tr>
                      <td className="bg-slate-50 border-r-[3px] border-slate-200 font-black text-[11px] text-slate-400 uppercase print:text-black">아침<br/><span className="text-[9px]">Breakfast</span></td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-[3px] border-slate-200 last:border-r-0 align-top">{renderCell(day.breakfast)}</td>)}
                    </tr>
                    {/* 아침 죽 */}
                    <tr className="bg-blue-50/40 print:bg-white">
                      <td className="border-r-[3px] border-slate-200 font-bold text-[10px] text-blue-500 italic">粥</td>
                      <td colSpan="7" className="p-2 text-[12px] font-bold text-blue-800 tracking-widest bg-blue-50/20 print:bg-white print:text-black print:border-y-2">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    {/* 점심 */}
                    <tr>
                      <td className="bg-slate-50 border-r-[3px] border-slate-200 font-black text-[11px] text-slate-400 uppercase print:text-black">점심<br/><span className="text-[9px]">Lunch</span></td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-[3px] border-slate-200 last:border-r-0 align-top">{renderCell(day.lunch, true)}</td>)}
                    </tr>
                    {/* 점심 죽 */}
                    <tr className="bg-blue-50/40 print:bg-white">
                      <td className="border-r-[3px] border-slate-200 font-bold text-[10px] text-blue-500 italic">粥</td>
                      <td colSpan="7" className="p-2 text-[12px] font-bold text-blue-800 tracking-widest bg-blue-50/20 print:bg-white print:text-black print:border-y-2">
                        쇠고기야채죽 / 흰죽 + (간장, 물김치, 맑은국)
                      </td>
                    </tr>
                    {/* 저녁 */}
                    <tr>
                      <td className="bg-slate-50 border-r-[3px] border-slate-200 font-black text-[11px] text-slate-400 uppercase print:text-black">저녁<br/><span className="text-[9px]">Dinner</span></td>
                      {weeklyPlan.map((day, i) => <td key={i} className="border-r-[3px] border-slate-200 last:border-r-0 align-top">{renderCell(day.dinner)}</td>)}
                    </tr>
                    {/* 간식 */}
                    <tr className="bg-rose-50/50 print:bg-white">
                      <td className="border-r-[3px] border-slate-200 font-bold text-[10px] text-rose-500 italic uppercase">간식</td>
                      {weeklyPlan.map((day, i) => (
                        <td key={i} className="p-4 border-r-[3px] border-slate-200 last:border-r-0 text-[12px] font-black text-rose-600 italic">
                          {day.snack || "과일쥬스"}
                        </td>
                      ))}
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="bg-white p-24 rounded-[3rem] border-4 border-dashed border-slate-200 text-center space-y-4 animate-in zoom-in-95 duration-700">
                <ChefHat size={60} className="mx-auto text-slate-200" />
                <p className="font-black text-slate-400 text-xl italic tracking-tighter">신도시이진병원 영양관리 시스템 접속 완료</p>
                <p className="text-blue-500 font-bold text-sm">오른쪽 상단 'AI 자동 식단 생성' 버튼을 눌러주세요!</p>
              </div>
            )}
          </div>
        )}

        {/* 히스토리 및 설정 (인쇄 시 숨김) */}
        <div className="print:hidden">
          {activeTab === 'history' && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 animate-in slide-in-from-right-4 duration-500">
              {history.map((h, i) => (
                <div key={h.id} className="bg-white p-8 rounded-[2.5rem] shadow-xl border border-slate-100 hover:border-blue-400 transition-all group relative overflow-hidden">
                   <div className="absolute top-0 left-0 w-2 h-full bg-blue-600 opacity-0 group-hover:opacity-100 transition-all" />
                  <div className="flex justify-between items-start mb-6">
                    <span className="text-[10px] font-black text-blue-500 bg-blue-50 px-4 py-1.5 rounded-full uppercase tracking-widest">{i === 0 ? "Latest" : `Record #${history.length - i}`}</span>
                    <span className="text-[10px] text-slate-300 font-bold">{h.createdAt ? new Date(h.createdAt.seconds * 1000).toLocaleDateString() : 'Processing...'}</span>
                  </div>
                  <div className="space-y-3 mb-8 text-xs font-bold text-slate-700">
                    <div className="flex justify-between border-b border-slate-50 pb-2"><span>월요일 대표 메뉴</span><span className="text-blue-600">{h.plan[0].lunch[0]}</span></div>
                    <div className="flex justify-between border-b border-slate-50 pb-2"><span>수요일 대표 메뉴</span><span className="text-blue-600">{h.plan[2].lunch[0]}</span></div>
                    <div className="flex justify-between"><span>금요일 대표 메뉴</span><span className="text-blue-600">{h.plan[4].lunch[0]}</span></div>
                  </div>
                  <button onClick={() => {setWeeklyPlan(h.plan); setActiveTab('planner');}} className="w-full py-4 bg-slate-50 group-hover:bg-blue-600 group-hover:text-white text-slate-500 rounded-2xl text-xs font-black transition-all shadow-inner active:scale-95">이 식단표 불러오기</button>
                </div>
              ))}
              {history.length === 0 && <div className="col-span-full py-32 text-center text-slate-300 font-black italic text-2xl opacity-50">저장된 데이터가 없습니다.</div>}
            </div>
          )}

          {activeTab === 'settings' && (
            <div className="max-w-xl mx-auto animate-in zoom-in duration-300">
              <div className="bg-white p-12 rounded-[3.5rem] shadow-2xl border border-rose-50 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-rose-50 rounded-full -mr-16 -mt-16 opacity-50" />
                <div className="flex items-center gap-4 mb-10 relative">
                  <div className="bg-blue-600 p-4 rounded-2xl shadow-lg shadow-blue-100"><Key className="text-white" size={24}/></div>
                  <div><h3 className="text-2xl font-black text-slate-800 tracking-tight">서비스 설정</h3><p className="text-slate-400 text-[10px] font-bold uppercase tracking-widest">System Configuration</p></div>
                </div>
                <div className="space-y-8 relative">
                  <div>
                    <label className="block text-[11px] font-black text-slate-400 mb-3 uppercase tracking-widest px-1 flex justify-between">Gemini API Key <Info size={14}/></label>
                    <input type="password" value={userSettings.geminiKey} onChange={(e) => setUserSettings({...userSettings, geminiKey: e.target.value})} placeholder="AI Studio에서 발급받은 키를 입력하세요" className="w-full px-8 py-5 rounded-[1.5rem] bg-slate-50 border-none focus:ring-2 focus:ring-blue-500 font-bold transition-all shadow-inner outline-none text-sm" />
                  </div>
                  <button onClick={async () => {
                    if (!user || !db) return;
                    try {
                      const settingsRef = doc(db, 'artifacts', appId, 'users', user.uid, 'settings', 'config');
                      await setDoc(settingsRef, userSettings, { merge: true });
                      setActiveTab('planner');
                    } catch (err) { setError("설정 저장에 실패했습니다."); }
                  }} className="w-full py-5 bg-slate-900 hover:bg-black text-white rounded-[1.5rem] font-black shadow-xl transition-all active:scale-95 disabled:opacity-50" disabled={!user}>설정 저장 및 적용</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="mt-20 py-16 text-center opacity-40 text-[10px] font-black uppercase tracking-[0.6em] text-slate-400 border-t border-slate-200 max-w-[1200px] mx-auto print:hidden">
        Made for Jihyun with Love by Her Husband
      </footer>
    </div>
  );
};

export default App;