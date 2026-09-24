var q=Object.defineProperty;
var f=(e,
n)=>q(e,
"name",
 {value:n,
  configurable:!0
});
import W from"../utils/fetchHttp.js";
import {
  Readable as K
}from"stream";
import {
  getHfBase as Hb
}from"../utils/hfClient.js";
const D=process.env.INTERNAL_TOKEN??"",
z=55e3,
$=new Map;
async function d(e,
n) {
  if(n==="bot")return"🤖 البوت";
  try {
    return await new Promise((s,
    t)=> {
      e.getUserInfo(n,
      (o,
      a)=> {
        if(o||!a?.[n])return t(o||new Error("no info"));
        const i=a[n];
        s(i.name||i.fullName||`${i.firstName||""} ${i.lastName||""}`.trim()||String(n).slice(-4))
      })
    })
  }catch {
    return String(n).slice(-4)
  }}f(d,
"getUserName");
async function I() {
  if(!global.db)return null;
  try {
    return global.db.db("chess_games")
  }catch {
    return null
  }}f(I,
"getCol");
async function C(e,
n) {
  const s=await I();
  if(s)try {
    return await s.findOne( {
      threadID:e,
      status:"active",
      $or:[ {
        player_white:n
      }, {player_black:n
      }]
    })
  }catch(t) {
    console.warn("[CHESS DB]",
    t.message)
  }for(const[,
  t]of $)if(t.threadID===e&&t.status==="active"&&(t.player_white===n||t.player_black===n))return t;
  return null
}f(C,
"findActiveGame");
async function X(e) {
  e.status="active",
  e.createdAt=new Date().toISOString();
  const n=await I();
  if(n)try {
    const t=await n.insertOne(e);
    return e._id=t.insertedId.toString(),
    e
  }catch(t) {
    console.warn("[CHESS DB]",
    t.message)
  }const s=`${e.threadID}_${Date.now()}`;
  return e._id=s,
  $.set(s,
   {...e
  }),
  e
}f(X,
"createGame");
async function k(e,
n) {
  const s=await I();
  if(s)try {
    const {
      ObjectId:o
    }=(await import("mongoose")).Types;
    let a;
    try {
      a= {
        _id:new o(e)
      }}catch {
      a= {
        _id:e
      }}await s.updateOne(a,
     {$set:n
    });
    return
  }catch(o) {
    console.warn("[CHESS DB]",
    o.message)
  }const t=$.get(String(e));
  t&&$.set(String(e),
   {...t,
    ...n
  })
}f(k,
"updateGame");
async function G(e,
n=null) {
  await k(e,
   {status:"completed",
    winner:n,
    endedAt:new Date().toISOString()
  })
}f(G,
"endGame");
async function N(e,
n,
s=!1,
t=T,
o="white") {
  const a=`${Hb()}/process_move`;
  return(await W.post(a,
   {fen:e,
    move:n||null,
    bot_mode:s,
    difficulty:t,
    perspective:o
  }, {timeout:z,
    headers: {
      "Content-Type":"application/json",
      ...D? {
        "X-Internal-Token":D
      }: {
      }}})).data
}f(N,
"callChessEngine");
const E="rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
T=10;
function R(e) {
  return e.replace(/\s+/g,
  "").toLowerCase()
}f(R,
"normalizeMove");
function Y(e) {
  return/^[a-h][1-8][a-h][1-8][qrbnQRBN]?$/.test(R(e))
}f(Y,
"isChessMove");
async function A(e,
n,
s,
t,
o) {
  try {
    const a=Buffer.from(t,
    "base64"),
    i=K.from(a);
    i.path="chess_board.png",
    await new Promise((g,
    w)=>global.safeSend(e,
     {body:o,
      attachment:i
    },n,
    (r,
    l)=>r?w(r):g(l),
    s))
  }catch {
    global.safeSend(e,
    o+`
⚠️ (تعذّر إرسال الصورة)`,
    n,
    null,
    s)
  }}f(A,
"sendBoardImageDirect");
function U(e,
n) {
  return e?e==="أبيض"||e.toLowerCase().includes("white")?n.player_white:n.player_black:null
}f(U,
"winnerPlayerId");
const H=`♟️ قواعد بوت الشطرنج الرسومي
━━━━━━━━━━━━━━━━━━━━━━━━━
🚀 بدء لعبة:
  chess bot      — ضد الذكاء الاصطناعي
  chess @شخص     — تحدي عضو في المجموعة
  ردّ على رسالة + chess — تحدي صاحبها
  ⚡ الألوان تُحدَّد عشوائياً عند البدء
🎮 كيف تكتب النقلة (نظام UCI):
  من أين + إلى أين (بمسافة أو بدونها)
  ✅ e2e4   ✅ E2 E4   ✅ e2 e4  (كلها مقبولة)
♟️ النقلات الخاصة:
  • التبييت القصير ← e1g1 (ملك أبيض)
                      e8g8 (ملك أسود)
  • التبييت الطويل ← e1c1 (ملك أبيض)
                      e8c8 (ملك أسود)
  • الأخذ بالتجاوز ← تلقائي (اكتب النقلة العادية)
  • ترقية البيدق:
      e7e8q  — وزير  ♛ (الأقوى، افتراضي)
      e7e8r  — قلعة  ♜
      e7e8b  — فيل   ♝
      e7e8n  — حصان  ♞
    (بدون حرف = ترقية تلقائية لوزير)
⚠️ أثناء اللعبة:
  resign     — استسلام فوري
  chess help — عرض هذه القواعد مجدداً
📌 ملاحظات:
  • لا يمكن بدء لعبتين في نفس الوقت
  • النقلات غير القانونية تُرفض بصمت
  • في لعبة البوت: يرد تلقائياً بعد كل نقلتك`;
var ee= {
  config: {
    name:"chess",
    aliases:["شطرنج"],
    version:"2.1.0",
    author:"Sunken",
    countDown:5,
    role:0,
    category:"ألعاب وترفيه",
    description:"بوت شطرنج رسومي للمجموعات (ضد لاعب أو ضد البوت)",
    usage:["{pn}chess bot — بدء مباراة ضد الذكاء الاصطناعي",
    "{pn}chess @شخص — تحدي لاعب عبر منشن",
    "رد على رسالة + {pn}chess — تحدي صاحب الرسالة",
    "e2e4 (أو أي نقلة صحيحة) — تُلعب تلقائياً أثناء مباراة نشطة، بلا أمر",
    "resign / استسلام — الاستسلام من المباراة الحالية",
    "{pn}chess help — عرض القواعد الكاملة والنقلات الخاصة"]
  },onChat:f(async function( {
    api:e,
    event:n
  }) {
    const {
      threadID:s,
      senderID:t,
      body:o,
      messageID:a
    }=n;
    if(!o?.trim())return;
    const i=o.trim(),
    g=i.toLowerCase().trim();
    if(g==="chess help"||g==="شطرنج مساعدة")return global.safeSend(e,
    H,
    s,
    null,
    a);
    if(g==="resign"||g==="استسلام") {
      const u=await C(s,
      t);
      if(!u)return;
      const b=u.player_white===t?u.player_black:u.player_white;
      await G(u._id,
      b);
      const _=await d(e,
      b);
      return global.safeSend(e,
      `🏳️ استسلم اللاعب!
🏆 الفائز: ${_}`,
      s,
      null,
      a)
    }if(!Y(i))return;
    const w=R(i),
    r=await C(s,
    t);
    if(!r||r.current_turn!==t)return;
    const l=r.player_black==="bot"||r.player_white==="bot";
    let c;
    try {
      const u=l?r.player_white==="bot"?r.player_black:r.player_white:t,
      m=r.player_white===u?"white":"black";
      c=await N(r.fen,
      w,
      l,
      r.difficulty||T,
      m)
    }catch(u) {
      return global.safeSend(e,
      `⚠️ فشل الاتصال بسيرفر الشطرنج
${u.message?.substring(0,80)}`,
      s,
      null,
      a)
    }if(c.illegal_move_error)return global.safeSend(e,
    c.illegal_move_error,
    s,
    null,
    a);
    if(c.game_over)await G(r._id,
    U(c.winner,
    r));
    else {
      const u=l?t:r.current_turn===r.player_white?r.player_black:r.player_white;
      await k(r._id,
       {fen:c.new_fen,
        current_turn:u
      })
    }let p;
    if(c.game_over)c.winner?p=`♟️ كش مات!
🏆 الفائز: ${await d(e,U(c.winner,r))}`:p="🤝 تعادل!";
    else {
      const b=w.length===5?`
⬆️ ترقية إلى ${{q:"وزير ♛",r:"قلعة ♜",b:"فيل ♝",n:"حصان ♞"}[w[4]]||"وزير ♛"}`:"";
      if(l)p=`✅ نقلتك: ${w.toUpperCase()}${b}
🤖 البوت لعب — دورك الآن!`;
      else {
        const _=r.current_turn===r.player_white?r.player_black:r.player_white,
        v=await d(e,
        _);
        p=`✅ نقلة: ${w.toUpperCase()}${b}
🎯 دور: ${v}`
      }}await A(e,
    s,
    a,
    c.image_base64,
    p)
  },"onChat"),
  onStart:f(async function( {
    api:e,
    event:n,
    args:s
  }) {
    const {
      threadID:t,
      senderID:o,
      messageID:a,
      mentions:i,
      messageReply:g
    }=n,
    w=s.join(" ").toLowerCase().trim();
    if(["help",
    "مساعدة",
    "قواعد"].includes(w))return global.safeSend(e,
    H,
    t,
    null,
    a);
    if(!w&&!g&&!Object.keys(i|| {
    }).length)return global.safeSend(e,
    `♟️ بوت الشطرنج
  chess bot   — ضد الذكاء الاصطناعي
  chess @شخص  — ضد لاعب
  رد + chess  — تحدي صاحب الرسالة
  chess help  — القواعد والنقلات الخاصة`,
    t,
    null,
    a);
    if(await C(t,
    o))return global.safeSend(e,
    `⚠️ لديك مباراة نشطة!
اكتب resign لإنهائها أولاً.`,
    t,
    null,
    a);
    let l=null,
    c="",
    p=T;
    if(w.match(/^(bot|بوت)$/))l="bot",
    c="🤖 البوت";
    else if(Object.keys(i|| {
    }).length>0)l=Object.keys(i)[0],
    c=await d(e,
    l);
    else if(g) {
      if(l=g.senderID,
      !l||l===o)return global.safeSend(e,
      "❌ لا يمكنك تحدي نفسك!",
      t,
      null,
      a);
      c=await d(e,
      l)
    }else return global.safeSend(e,
    `❌ حدد منافسك:
  chess bot — ضد البوت
  chess @شخص — ضد لاعب`,
    t,
    null,
    a);
    if(l!=="bot"&&await C(t,
    l))return global.safeSend(e,
    "⚠️ هذا اللاعب لديه مباراة نشطة بالفعل!",
    t,
    null,
    a);
    const m=Math.random()<.5,
    b=m?o:l,
    _=m?l:o,
    v=b,
    j=m?"⬜ أبيض":"⬛ أسود",
    x=m?"⬛ أسود":"⬜ أبيض",
    M=await d(e,
    o),
    L=await X( {
      threadID:t,
      player_white:b,
      player_black:_,
      current_turn:v,
      fen:E,
      difficulty:p
    });
    let O=E,
    y=null,
    P="";
    if(l==="bot"&&b==="bot")try {
      const h=await N(E,
      null,
      !0,
      p,
      "black");
      O=h.new_fen,
      y=h.image_base64,
      P=`
🤖 البوت فتح اللعبة — دورك الآن!`,
      await k(L._id,
       {fen:O,
        current_turn:o
      })
    }catch(h) {
      const S=h.response?.data?.detail||h.message;
      console.warn("[CHESS] نقلة البوت الأولى فشلت:",
      S),
      await k(L._id,
       {status:"aborted",
        abortReason:S,
        endedAt:new Date().toISOString()
      }),
      await global.safeSend(e,
      `⚠️ تعذّر بدء اللعبة — فشل البوت في لعب النقلة الأولى.
${String(S).substring(0,150)}
حاول مرة أخرى بعد قليل.`,
      t,
      null,
      a);
      return
    }else try {
      const h=L.player_white===o?"white":"black";
      y=(await N(E,
      null,
      !1,
      p,
      h)).image_base64
    }catch(h) {
      console.warn("[CHESS] فشل صورة البداية:",
      h.response?.data?.detail||h.message)
    }const F=b==="bot"?"🤖 البوت (لعب بالفعل)":await d(e,
    b),
    B=`♟️ بدأت مباراة شطرنج!
${j}: ${M}
${x}: ${c}
🎯 يبدأ: ${F}${P}
`+(l==="bot"&&b!=="bot"?`🤖 البوت سيرد تلقائياً بعد كل نقلتك
`:"")+`
💡 chess help — لمعرفة النقلات الخاصة`;
    y?await A(e,
    t,
    a,
    y,
    B):global.safeSend(e,
    B,
    t,
    null,
    a)
  },"onStart")
};export {
  ee as default
};

// ─── Plugin Descriptor ──────────────────────────────────────────
/** @type {import('../plugin-provider.js').XxPlugin} */
export const $plugin = {
  name: 'xx-commands-fun-chess',
  meta: { category: 'command-fun', path: 'src/commands/fun/chess.js' },
  setup(_ctx) {
    // provides: ee
  },
};
