/* All on-stream and panel text in one place. Amharic first, English under it. Same glossary as the GOLOW website
 * and the Telegram bot: auction = ጨረታ, bid = ዋጋ. A native speaker must review the Amharic before going live. */
window.GolowText = {
  newBid: { am: "🔥 አዲስ ዋጋ ገብቷል!", en: "New bid!" },
  bidsUnit: "ዋጋዎች",
  left: function (n) { return n + " ቀርቷል"; },
  done: "ተጠናቋል",
  hot: "🔥 HOT",
  retail: "የገበያ ዋጋ / Retail",
  feePerBid: "የጨረታ ክፍያ / Fee per bid",
  closed: { am: "🔒 ጨረታው ተዘግቷል!", en: "Bidding closed — results coming…" },
  winner: { am: "አሸናፊ ተገኝቷል!", en: "We have a winner!" },
  noWinner: { am: "ልዩ አሸናፊ ዋጋ የለም", en: "No unique winning bid" },
  cancelled: { am: "ጨረታው ተሰርዟል", en: "Auction cancelled" },
  go: { am: "ተጫረቱ!", en: "Bid now!" },
  pickAuction: "Pick an auction in the control panel",
  ctaDefault: "አሁኑኑ ይጫረቱ! | Bid now on golow.et",
  // New GOLOW users (name = first name + last initial, from the server).
  welcome: function (name) { return { am: "👋 እንኳን ደህና መጡ" + (name ? "፣ " + name : "") + "!", en: name ? "Welcome to GOLOW!" : "A new member joined GOLOW!" }; },
  welcomeMany: function (n) { return { am: "👋 እንኳን ደህና መጣችሁ! +" + n, en: n + " new members joined GOLOW!" }; },
  rulesTitle: { am: "እንዴት ይሠራል?", en: "How it works" },
  rules: [
    { am: "በgolow.et ላይ ከ1 ብር ጀምሮ ዋጋ ያቅርቡ", en: "Bid on golow.et from 1 ETB" },
    { am: "ተመሳሳይ ዋጋዎች ይሰረዛሉ", en: "Matching bids cancel each other out" },
    { am: "ዝቅተኛው ብቸኛ ዋጋ ያሸንፋል", en: "The lowest unique bid wins" },
    { am: "ከአንድ ጊዜ በላይ መጫረት ይችላሉ", en: "You can bid more than once" }
  ],
  board: { am: "የቀጥታ ጨረታዎች", en: "Live auctions on golow.et" },
  result: "ውጤት",
  unique: "ልዩ",
  winnerTag: "አሸናፊ!",
  revealGated: "Bids are only revealed after the auction is finalized",
  legend: "❌ ተመሳሳይ ዋጋ ተሰርዟል · Duplicate, cancelled   👑 ዝቅተኛው ብቸኛ ዋጋ · Lowest unique bid",
  totalBids: function (n) { return n + " ዋጋዎች · bids"; },
  distinct: function (n) { return n + " የተለያዩ መጠኖች · distinct amounts"; },

  // Panel presets: line 1 = big (Amharic), line 2 = small (English).
  quick: [
    "አሁኑኑ ይጫረቱ!\nBid now!",
    "ጥቂት ዋጋዎች ብቻ ቀርተዋል!\nOnly a few bids left!",
    "ዝቅተኛው ብቸኛ ዋጋ ያሸንፋል\nThe lowest unique bid wins",
    "golow.et ላይ ይጫረቱ\nBid on golow.et",
    "በቴሌግራምም መጫረት ይችላሉ\nYou can also bid on Telegram",
    "ስለተከታተሉን እናመሰግናለን!\nThanks for watching!"
  ],
  script: [
    "እንኳን ደህና መጡ ወደ GOLOW ቀጥታ!\nWelcome to GOLOW Live!",
    "ዛሬ የምንጫረተው በጣም ልዩ ሽልማት ነው\nToday's prize is something special",
    "ዝቅተኛው ብቸኛ ዋጋ ያሸንፋል — ማንም ያልመረጠውን ዋጋ ይምረጡ\nLowest unique bid wins — pick an amount nobody else picked",
    "ከ1 ብር ጀምሮ መጫረት ይችላሉ\nYou can bid from 1 ETB",
    "ተመሳሳይ ዋጋ ያቀረቡ ሁሉ ይሰረዛሉ\nEveryone who picks the same amount is cancelled",
    "ከአንድ ጊዜ በላይ መጫረት ይቻላል\nYou can bid more than once",
    "ጨረታው ሊዘጋ ጥቂት ቀርቷል!\nThe auction is about to close!",
    "ውጤቱን አብረን እንመልከት!\nLet's reveal the result together!"
  ]
};
