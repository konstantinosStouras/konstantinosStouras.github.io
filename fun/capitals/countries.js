/*
 * countries.js — dataset for the Capitals world-capitals quiz.
 *
 * Each entry:
 *   c      country name (display + question)
 *   cap    capital (the expected answer, display form may include diacritics)
 *   region continent / region used for the filter
 *   flag   flag emoji (decorative)
 *   alt    array of accepted alternative answers (former names, second
 *          capitals, alternative transliterations). Matching is
 *          accent and case insensitive, so plain spellings need not be listed.
 *   facts  exactly two short paragraphs shown after a correct answer.
 *
 * Capitals are checked against `cap` and `alt` after Unicode normalisation
 * (accents stripped, case folded, punctuation loosened) by the app.
 */
window.COUNTRIES = [

  /* ===================== EUROPE ===================== */
  { c: "Albania", cap: "Tirana", region: "Europe", flag: "🇦🇱", alt: [],
    facts: [
      "Albania spent much of the 20th century in near total isolation under a communist regime, and the countryside is still dotted with tens of thousands of small concrete bunkers built during that era.",
      "Tirana, the capital, became famous in the 2000s when its mayor had grey communist-era apartment blocks painted in bright colours and bold patterns to lift the mood of the city."
    ] },
  { c: "Andorra", cap: "Andorra la Vella", region: "Europe", flag: "🇦🇩", alt: [],
    facts: [
      "Andorra is a tiny principality in the Pyrenees co-governed, in a tradition dating back centuries, by two heads of state: the President of France and a Spanish bishop.",
      "Andorra la Vella sits at around 1,000 metres above sea level, making it the highest capital city in Europe, and the country thrives on skiing and duty-free shopping."
    ] },
  { c: "Austria", cap: "Vienna", region: "Europe", flag: "🇦🇹", alt: ["Wien"],
    facts: [
      "Austria was the heart of the Habsburg Empire and gave the world Mozart, Schubert and the waltz, as well as the psychoanalysis of Sigmund Freud.",
      "Vienna is regularly ranked among the most liveable cities in the world, famous for its coffee houses, grand opera and the imperial palaces of the Habsburgs."
    ] },
  { c: "Belarus", cap: "Minsk", region: "Europe", flag: "🇧🇾", alt: [],
    facts: [
      "Belarus is one of Europe's most heavily forested countries and contains part of the ancient Bialowieza Forest, home to Europe's largest land animal, the European bison.",
      "Minsk was almost completely destroyed in the Second World War and rebuilt in a grand Soviet style, with wide avenues and monumental Stalinist architecture."
    ] },
  { c: "Belgium", cap: "Brussels", region: "Europe", flag: "🇧🇪", alt: ["Bruxelles"],
    facts: [
      "Belgium is world famous for its chocolate, waffles and beer, and it brews hundreds of distinct varieties, several by Trappist monks.",
      "Brussels is often called the capital of Europe because it hosts the headquarters of the European Union and NATO."
    ] },
  { c: "Bosnia and Herzegovina", cap: "Sarajevo", region: "Europe", flag: "🇧🇦", alt: [],
    facts: [
      "Bosnia and Herzegovina is where the spark for the First World War was lit, when Archduke Franz Ferdinand was assassinated in Sarajevo in 1914.",
      "Sarajevo has long been a meeting point of cultures, with mosques, Orthodox and Catholic churches and a synagogue standing within a short walk of one another."
    ] },
  { c: "Bulgaria", cap: "Sofia", region: "Europe", flag: "🇧🇬", alt: [],
    facts: [
      "Bulgarians invented the Cyrillic alphabet in the 9th century, a script now used by hundreds of millions of people from Russia to Mongolia.",
      "Sofia is one of the oldest cities in Europe, with Roman ruins sitting beneath its streets, and the snow-capped Vitosha mountain rising just behind it."
    ] },
  { c: "Croatia", cap: "Zagreb", region: "Europe", flag: "🇭🇷", alt: [],
    facts: [
      "Croatia's Adriatic coast has more than a thousand islands, and the walled city of Dubrovnik served as a backdrop for the fictional King's Landing on screen.",
      "Zagreb, the inland capital, is known for its red-roofed Upper Town, lively cafe culture and the quirky Museum of Broken Relationships."
    ] },
  { c: "Czechia", cap: "Prague", region: "Europe", flag: "🇨🇿", alt: ["Praha", "Czech Republic"],
    facts: [
      "Czechia consumes more beer per person than any other country on Earth, and the original Pilsner lager was brewed in the city of Plzen.",
      "Prague's medieval astronomical clock, mounted on the Old Town Hall, has been keeping time since 1410 and is one of the oldest still working in the world."
    ] },
  { c: "Denmark", cap: "Copenhagen", region: "Europe", flag: "🇩🇰", alt: ["Kobenhavn"],
    facts: [
      "Denmark gave the world the writer Hans Christian Andersen and the toy bricks of LEGO, whose name comes from the Danish for 'play well'.",
      "Copenhagen is one of the most bicycle-friendly cities anywhere, with more bikes than cars and a famous Little Mermaid statue by the harbour."
    ] },
  { c: "Estonia", cap: "Tallinn", region: "Europe", flag: "🇪🇪", alt: [],
    facts: [
      "Estonia is one of the most digitally advanced nations on Earth, where citizens vote online and the messaging app Skype was first developed.",
      "Tallinn has one of the best preserved medieval old towns in Europe, ringed by stone walls and watchtowers from the Hanseatic era."
    ] },
  { c: "Finland", cap: "Helsinki", region: "Europe", flag: "🇫🇮", alt: [],
    facts: [
      "Finland has been ranked the happiest country in the world for several years running and has more saunas than it has cars.",
      "Helsinki sits on a peninsula in the Baltic Sea, and in midsummer the sun barely sets, bathing the city in long bright nights."
    ] },
  { c: "France", cap: "Paris", region: "Europe", flag: "🇫🇷", alt: [],
    facts: [
      "France is the most visited country in the world, drawing travellers to its art, cuisine, vineyards and the chateaux of the Loire Valley.",
      "Paris was meant to keep the Eiffel Tower for only 20 years after the 1889 World's Fair, but the iron tower became the enduring symbol of the city."
    ] },
  { c: "Germany", cap: "Berlin", region: "Europe", flag: "🇩🇪", alt: [],
    facts: [
      "Germany is Europe's largest economy and the birthplace of the printing press, the automobile and the modern university.",
      "Berlin was divided by a wall for 28 years, and since its fall in 1989 the city has become a global capital of art, music and nightlife."
    ] },
  { c: "Greece", cap: "Athens", region: "Europe", flag: "🇬🇷", alt: ["Athina"],
    facts: [
      "Did you know that Greece is widely regarded as the birthplace of democracy, philosophy, theatre and the Olympic Games? Thinkers like Socrates, Plato and Aristotle laid foundations still studied today.",
      "Athens is one of the oldest continuously inhabited cities in the world, with a history of more than 3,000 years, crowned by the marble temples of the Acropolis."
    ] },
  { c: "Hungary", cap: "Budapest", region: "Europe", flag: "🇭🇺", alt: [],
    facts: [
      "Hungarian is one of Europe's most unusual languages, unrelated to its neighbours and distantly linked to Finnish and Estonian.",
      "Budapest was formed by uniting the hilly town of Buda with flat Pest across the Danube, and it sits atop more than a hundred thermal springs feeding grand public baths."
    ] },
  { c: "Iceland", cap: "Reykjavik", region: "Europe", flag: "🇮🇸", alt: ["Reykjavík"],
    facts: [
      "Iceland runs almost entirely on renewable energy, tapping the heat of its volcanoes and the power of its rivers, and it has no mosquitoes.",
      "Reykjavik is the world's northernmost capital of a sovereign state, where winters bring the dancing northern lights and summers bring the midnight sun."
    ] },
  { c: "Ireland", cap: "Dublin", region: "Europe", flag: "🇮🇪", alt: ["Baile Atha Cliath"],
    facts: [
      "Ireland is known as the Emerald Isle for its lush green landscape, and it has produced an extraordinary number of writers, including four Nobel laureates.",
      "Dublin was a centre of literary genius for James Joyce, Oscar Wilde and W.B. Yeats, and the dark stout Guinness has been brewed there since 1759."
    ] },
  { c: "Italy", cap: "Rome", region: "Europe", flag: "🇮🇹", alt: ["Roma"],
    facts: [
      "Italy has more UNESCO World Heritage sites than any other country and was the cradle of the Roman Empire and the Renaissance.",
      "Rome, the Eternal City, completely surrounds Vatican City, an independent state, and visitors toss coins into the Trevi Fountain hoping to return one day."
    ] },
  { c: "Kosovo", cap: "Pristina", region: "Europe", flag: "🇽🇰", alt: ["Prishtina"],
    facts: [
      "Kosovo is one of the youngest countries in the world, having declared independence in 2008, and it has one of Europe's youngest populations.",
      "Pristina is a fast-changing capital where Ottoman-era mosques stand alongside modern monuments, including a striking tribute to former US president Bill Clinton."
    ] },
  { c: "Latvia", cap: "Riga", region: "Europe", flag: "🇱🇻", alt: [],
    facts: [
      "Latvia is covered by forest across more than half its territory and treasures amber, the fossilised tree resin washed up along its Baltic shore.",
      "Riga boasts one of the world's finest collections of Art Nouveau architecture, with ornate facades lining whole streets of the city centre."
    ] },
  { c: "Liechtenstein", cap: "Vaduz", region: "Europe", flag: "🇱🇮", alt: [],
    facts: [
      "Liechtenstein is a tiny alpine principality between Switzerland and Austria, one of only two doubly landlocked countries on Earth, and famously produces dental crowns and sausage casings for export.",
      "Vaduz is overlooked by a hilltop castle that is still the home of the reigning prince, and the whole country is small enough to cross on foot in a day."
    ] },
  { c: "Lithuania", cap: "Vilnius", region: "Europe", flag: "🇱🇹", alt: [],
    facts: [
      "Lithuania was once part of the largest country in Europe, the Polish-Lithuanian Commonwealth, and it was the first Soviet republic to declare independence in 1990.",
      "Vilnius has a sprawling baroque old town, and one of its bohemian neighbourhoods, Uzupis, jokingly declared itself an independent republic with its own playful constitution."
    ] },
  { c: "Luxembourg", cap: "Luxembourg", region: "Europe", flag: "🇱🇺", alt: ["Luxembourg City"],
    facts: [
      "Luxembourg is one of the wealthiest countries in the world per person and a founding member of the European Union, with three official languages.",
      "Luxembourg City is built across deep gorges spanned by elegant bridges, and in 2020 the country became the first to make all public transport free."
    ] },
  { c: "Malta", cap: "Valletta", region: "Europe", flag: "🇲🇹", alt: [],
    facts: [
      "Malta is a sun-drenched Mediterranean archipelago packed with temples older than the pyramids and a language written in the Latin alphabet but rooted in Arabic.",
      "Valletta was built by the Knights of St John in the 16th century and is one of the most concentrated historic areas in the world."
    ] },
  { c: "Moldova", cap: "Chisinau", region: "Europe", flag: "🇲🇩", alt: ["Chișinău"],
    facts: [
      "Moldova is one of Europe's great wine countries, and the Milestii Mici cellars hold a labyrinth of underground tunnels storing millions of bottles.",
      "Chisinau is a green capital of leafy parks and Soviet-era boulevards, set among the rolling vineyards of one of the continent's least visited nations."
    ] },
  { c: "Monaco", cap: "Monaco", region: "Europe", flag: "🇲🇨", alt: ["Monaco-Ville", "Monte Carlo"],
    facts: [
      "Monaco is the second smallest country in the world, a glamorous city-state on the French Riviera famous for its casino and its Formula One street race.",
      "The principality has one of the highest densities of millionaires anywhere, and it has been ruled by the Grimaldi family for more than seven centuries."
    ] },
  { c: "Montenegro", cap: "Podgorica", region: "Europe", flag: "🇲🇪", alt: ["Cetinje"],
    facts: [
      "Montenegro means 'black mountain', and its dramatic peaks plunge straight into the deep blue fjord-like Bay of Kotor on the Adriatic.",
      "Podgorica is the modern administrative capital, while the old royal capital of Cetinje still holds the country's historic and cultural heart."
    ] },
  { c: "Netherlands", cap: "Amsterdam", region: "Europe", flag: "🇳🇱", alt: [],
    facts: [
      "The Netherlands has reclaimed much of its land from the sea, and roughly a quarter of the country lies below sea level, protected by dikes and pumps.",
      "Amsterdam is laced with concentric canals lined by tall merchant houses, and although it is the capital, the government actually sits in The Hague."
    ] },
  { c: "North Macedonia", cap: "Skopje", region: "Europe", flag: "🇲🇰", alt: ["Macedonia"],
    facts: [
      "North Macedonia is a landlocked Balkan country whose Lake Ohrid is one of the oldest and deepest lakes in Europe.",
      "Skopje, the birthplace of Mother Teresa, reinvented its centre with a striking and much debated array of grand statues and neoclassical buildings."
    ] },
  { c: "Norway", cap: "Oslo", region: "Europe", flag: "🇳🇴", alt: [],
    facts: [
      "Norway's coastline is carved into spectacular fjords by ancient glaciers, and the country awards the Nobel Peace Prize each year.",
      "Oslo sits at the head of a fjord and is surrounded by forests and ski slopes, making it a capital where city life and wilderness meet."
    ] },
  { c: "Poland", cap: "Warsaw", region: "Europe", flag: "🇵🇱", alt: ["Warszawa"],
    facts: [
      "Poland gave the world the astronomer Copernicus, the composer Chopin and the scientist Marie Curie, who won Nobel Prizes in two different fields.",
      "Warsaw was reduced to rubble in the Second World War and its old town was painstakingly rebuilt from paintings and photographs, brick by brick."
    ] },
  { c: "Portugal", cap: "Lisbon", region: "Europe", flag: "🇵🇹", alt: ["Lisboa"],
    facts: [
      "Portugal was a great seafaring power during the Age of Discovery, when explorers like Vasco da Gama opened sea routes to India and beyond.",
      "Lisbon is one of the oldest cities in Western Europe, built across seven hills, and its mournful Fado music drifts from the old Alfama district."
    ] },
  { c: "Romania", cap: "Bucharest", region: "Europe", flag: "🇷🇴", alt: ["Bucuresti"],
    facts: [
      "Romania's Transylvania region inspired the legend of Dracula, drawing on the medieval ruler Vlad the Impaler and its mist-shrouded castles.",
      "Bucharest's Palace of the Parliament is one of the largest and heaviest administrative buildings in the world, built under the dictator Ceausescu."
    ] },
  { c: "Russia", cap: "Moscow", region: "Europe", flag: "🇷🇺", alt: ["Moskva"],
    facts: [
      "Russia is by far the largest country on Earth, stretching across eleven time zones and spanning both Europe and Asia.",
      "Moscow's Red Square is framed by the candy-coloured onion domes of Saint Basil's Cathedral and the red walls of the Kremlin."
    ] },
  { c: "San Marino", cap: "San Marino", region: "Europe", flag: "🇸🇲", alt: ["City of San Marino"],
    facts: [
      "San Marino claims to be the oldest surviving republic in the world, traditionally founded in the year 301, and is entirely surrounded by Italy.",
      "The capital perches on the slopes of Monte Titano, crowned by three medieval towers that overlook the surrounding countryside."
    ] },
  { c: "Serbia", cap: "Belgrade", region: "Europe", flag: "🇷🇸", alt: ["Beograd"],
    facts: [
      "Serbia sits at the crossroads of Central and Southeast Europe, and its name for the capital, Beograd, means 'white city'.",
      "Belgrade stands where the Sava meets the mighty Danube, guarded by an ancient fortress, and is known for a lively riverside nightlife."
    ] },
  { c: "Slovakia", cap: "Bratislava", region: "Europe", flag: "🇸🇰", alt: [],
    facts: [
      "Slovakia has one of the highest numbers of castles and chateaux per person in the world, scattered across its forested Carpathian landscape.",
      "Bratislava is the only national capital that borders two other countries, sitting close to both Austria and Hungary along the Danube."
    ] },
  { c: "Slovenia", cap: "Ljubljana", region: "Europe", flag: "🇸🇮", alt: [],
    facts: [
      "Slovenia is one of the greenest countries in the world, with more than half its land covered by forest and a postcard-perfect alpine lake at Bled.",
      "Ljubljana is a small, walkable capital whose name evokes the word for 'beloved', filled with bridges, riverside cafes and the work of architect Joze Plecnik."
    ] },
  { c: "Spain", cap: "Madrid", region: "Europe", flag: "🇪🇸", alt: [],
    facts: [
      "Spain is the home of flamenco, the afternoon siesta and a running of the bulls, and its language is spoken by hundreds of millions worldwide.",
      "Madrid sits almost exactly at the geographic centre of the country and is among the highest capitals in Europe, full of world-class art museums."
    ] },
  { c: "Sweden", cap: "Stockholm", region: "Europe", flag: "🇸🇪", alt: [],
    facts: [
      "Sweden gave the world the Nobel Prizes, the band ABBA and the flat-pack furniture of IKEA, and it pioneered generous social welfare.",
      "Stockholm is built across fourteen islands linked by more than fifty bridges, earning it the nickname the Venice of the North."
    ] },
  { c: "Switzerland", cap: "Bern", region: "Europe", flag: "🇨🇭", alt: ["Berne"],
    facts: [
      "Switzerland is famous for its neutrality, its precision watches, its chocolate and its banks, and it sits among the peaks of the Alps.",
      "Bern, not the larger Zurich or Geneva, is the seat of government, and its arcaded old town curls inside a loop of the Aare river."
    ] },
  { c: "Ukraine", cap: "Kyiv", region: "Europe", flag: "🇺🇦", alt: ["Kiev"],
    facts: [
      "Ukraine is the largest country lying entirely within Europe and its fertile black soil long made it a breadbasket for the continent.",
      "Kyiv is one of the oldest cities in Eastern Europe and the historic cradle of the medieval state of Kievan Rus, with gold-domed monasteries above the Dnipro river."
    ] },
  { c: "United Kingdom", cap: "London", region: "Europe", flag: "🇬🇧", alt: ["Britain", "Great Britain"],
    facts: [
      "The United Kingdom unites England, Scotland, Wales and Northern Ireland, and once governed the largest empire in history.",
      "London has been a major settlement for some two thousand years since the Romans founded Londinium, and its Underground is the oldest metro system in the world."
    ] },
  { c: "Vatican City", cap: "Vatican City", region: "Europe", flag: "🇻🇦", alt: ["Vatican"],
    facts: [
      "Vatican City is the smallest country in the world, both by area and population, and serves as the spiritual and governing centre of the Roman Catholic Church.",
      "Within its walls stand St Peter's Basilica and the Sistine Chapel, whose ceiling Michelangelo painted in the early 16th century."
    ] },

  /* ===================== ASIA ===================== */
  { c: "Afghanistan", cap: "Kabul", region: "Asia", flag: "🇦🇫", alt: [],
    facts: [
      "Afghanistan sits at the crossroads of Asia along the ancient Silk Road, ringed by the towering Hindu Kush mountains.",
      "Kabul is one of the highest capital cities in the world, set in a valley more than 1,700 metres above sea level."
    ] },
  { c: "Armenia", cap: "Yerevan", region: "Asia", flag: "🇦🇲", alt: [],
    facts: [
      "Armenia was the first country in the world to adopt Christianity as its state religion, in the early 4th century.",
      "Yerevan is one of the world's oldest continuously inhabited cities, founded in 782 BC, and looks out toward the snow-capped Mount Ararat."
    ] },
  { c: "Azerbaijan", cap: "Baku", region: "Asia", flag: "🇦🇿", alt: [],
    facts: [
      "Azerbaijan is known as the Land of Fire, with natural flames that burn from gas seeping out of the ground.",
      "Baku sits on the shore of the Caspian Sea, below sea level, and pairs a medieval walled old town with futuristic flame-shaped skyscrapers."
    ] },
  { c: "Bahrain", cap: "Manama", region: "Asia", flag: "🇧🇭", alt: [],
    facts: [
      "Bahrain is a small island nation in the Persian Gulf that was a pearl-diving centre long before oil transformed the Gulf economies.",
      "Manama is a fast-modernising financial hub, connected to Saudi Arabia by a 25-kilometre causeway across the sea."
    ] },
  { c: "Bangladesh", cap: "Dhaka", region: "Asia", flag: "🇧🇩", alt: [],
    facts: [
      "Bangladesh sits on the world's largest river delta, where the Ganges and Brahmaputra meet the sea, and it is one of the most densely populated countries on Earth.",
      "Dhaka is famous as a city of rickshaws, with hundreds of thousands of brightly decorated cycle rickshaws filling its streets."
    ] },
  { c: "Bhutan", cap: "Thimphu", region: "Asia", flag: "🇧🇹", alt: [],
    facts: [
      "Bhutan measures progress through Gross National Happiness rather than wealth alone, and it is the only carbon-negative country in the world.",
      "Thimphu is one of the few world capitals with no traffic lights, where officers still direct cars by hand from the middle of intersections."
    ] },
  { c: "Brunei", cap: "Bandar Seri Begawan", region: "Asia", flag: "🇧🇳", alt: [],
    facts: [
      "Brunei is a small, oil-rich sultanate on the island of Borneo, ruled by one of the world's longest-reigning monarchs.",
      "Bandar Seri Begawan is home to Kampong Ayer, a sprawling water village of stilt houses that has stood on the river for centuries."
    ] },
  { c: "Cambodia", cap: "Phnom Penh", region: "Asia", flag: "🇰🇭", alt: [],
    facts: [
      "Cambodia is home to Angkor Wat, the largest religious monument in the world, built by the Khmer Empire and pictured on the national flag.",
      "Phnom Penh sits at the meeting point of three rivers and was once known as the Pearl of Asia for its elegant boulevards."
    ] },
  { c: "China", cap: "Beijing", region: "Asia", flag: "🇨🇳", alt: ["Peking"],
    facts: [
      "China is the most populous country in the world along with India, and its Great Wall stretches for thousands of kilometres across the north.",
      "Beijing has been a capital for centuries and contains the Forbidden City, the vast palace complex of the emperors of the Ming and Qing dynasties."
    ] },
  { c: "Cyprus", cap: "Nicosia", region: "Asia", flag: "🇨🇾", alt: ["Lefkosia"],
    facts: [
      "Cyprus, in legend the birthplace of the goddess Aphrodite, is the third largest island in the Mediterranean.",
      "Nicosia is the last divided capital in the world, split by a buffer zone between the island's Greek and Turkish communities."
    ] },
  { c: "Georgia", cap: "Tbilisi", region: "Asia", flag: "🇬🇪", alt: [],
    facts: [
      "Georgia is widely considered the birthplace of wine, where people have been making it in clay vessels for some 8,000 years.",
      "Tbilisi, whose name comes from the word for 'warm', grew up around natural hot sulphur springs that still feed its domed bathhouses."
    ] },
  { c: "India", cap: "New Delhi", region: "Asia", flag: "🇮🇳", alt: ["Delhi"],
    facts: [
      "India is the most populous country in the world, home to more than 1.4 billion people and the birthplace of Hinduism, Buddhism, Jainism and Sikhism.",
      "New Delhi, designed under British rule, sits beside the much older city of Delhi, and the marble Taj Mahal lies a short journey away in Agra."
    ] },
  { c: "Indonesia", cap: "Jakarta", region: "Asia", flag: "🇮🇩", alt: ["Nusantara"],
    facts: [
      "Indonesia is the largest archipelago on Earth, made up of more than 17,000 islands, and has the world's biggest Muslim population.",
      "Jakarta is sinking and congested, so the country is building a brand new capital called Nusantara on the island of Borneo to take its place."
    ] },
  { c: "Iran", cap: "Tehran", region: "Asia", flag: "🇮🇷", alt: [],
    facts: [
      "Iran, historically known as Persia, was the centre of one of the ancient world's great empires and is famed for its poetry, carpets and gardens.",
      "Tehran sits at the foot of the Alborz mountains, whose slopes offer ski resorts within sight of the busy capital below."
    ] },
  { c: "Iraq", cap: "Baghdad", region: "Asia", flag: "🇮🇶", alt: [],
    facts: [
      "Iraq covers ancient Mesopotamia, the land between the Tigris and Euphrates often called the cradle of civilisation, where writing was invented.",
      "Baghdad was once the dazzling capital of the Islamic Golden Age, a world centre of science, mathematics and learning."
    ] },
  { c: "Israel", cap: "Jerusalem", region: "Asia", flag: "🇮🇱", alt: ["Tel Aviv"],
    facts: [
      "Israel is a centre of high technology and innovation, sometimes nicknamed the start-up nation for its dense cluster of tech companies.",
      "Jerusalem is one of the oldest cities in the world and a holy place for Judaism, Christianity and Islam alike, with its ancient walled Old City at its heart."
    ] },
  { c: "Japan", cap: "Tokyo", region: "Asia", flag: "🇯🇵", alt: [],
    facts: [
      "Japan is a string of mountainous islands famed for blending ancient tradition with cutting-edge technology, from tea ceremonies to bullet trains.",
      "Tokyo is the most populous metropolitan area in the world, a vast and orderly megacity overlooked on clear days by the cone of Mount Fuji."
    ] },
  { c: "Jordan", cap: "Amman", region: "Asia", flag: "🇯🇴", alt: [],
    facts: [
      "Jordan is home to Petra, an entire city carved into rose-coloured rock by the ancient Nabataeans, now one of the New Seven Wonders of the World.",
      "Amman is built across a series of hills, and its core was once the Roman city of Philadelphia, complete with a hillside theatre still in use."
    ] },
  { c: "Kazakhstan", cap: "Astana", region: "Asia", flag: "🇰🇿", alt: ["Nur-Sultan", "Akmola", "Tselinograd"],
    facts: [
      "Kazakhstan is the largest landlocked country in the world and the world's leading producer of uranium, with vast steppe stretching to the horizon.",
      "Astana is a planned capital raised on the cold northern steppe, filled with bold futuristic architecture, and was briefly renamed Nur-Sultan."
    ] },
  { c: "Kuwait", cap: "Kuwait City", region: "Asia", flag: "🇰🇼", alt: [],
    facts: [
      "Kuwait sits on some of the world's largest oil reserves and is one of the hottest inhabited places on the planet in summer.",
      "Kuwait City's waterfront is marked by the Kuwait Towers, with their distinctive blue-green spheres rising above the Gulf."
    ] },
  { c: "Kyrgyzstan", cap: "Bishkek", region: "Asia", flag: "🇰🇬", alt: [],
    facts: [
      "Kyrgyzstan is a land of soaring mountains, where the Tian Shan ranges cover most of the country and nomadic traditions endure.",
      "Bishkek is a green, low-rise capital lined with trees and Soviet-era squares, set against a backdrop of snowy peaks."
    ] },
  { c: "Laos", cap: "Vientiane", region: "Asia", flag: "🇱🇦", alt: [],
    facts: [
      "Laos is the only landlocked country in Southeast Asia and is dotted with thousands of Buddhist temples and mysterious ancient stone jars.",
      "Vientiane is a sleepy riverside capital on the banks of the Mekong, looking across the water to neighbouring Thailand."
    ] },
  { c: "Lebanon", cap: "Beirut", region: "Asia", flag: "🇱🇧", alt: [],
    facts: [
      "Lebanon was home to the ancient Phoenicians, the seafaring traders credited with spreading the alphabet around the Mediterranean.",
      "Beirut has been destroyed and rebuilt many times over its long history, earning a reputation for resilience and a vibrant cultural life."
    ] },
  { c: "Malaysia", cap: "Kuala Lumpur", region: "Asia", flag: "🇲🇾", alt: [],
    facts: [
      "Malaysia is split between the Malay Peninsula and the island of Borneo, with rainforests among the oldest on Earth.",
      "Kuala Lumpur's twin Petronas Towers were the tallest buildings in the world when completed and remain the tallest twin towers."
    ] },
  { c: "Maldives", cap: "Male", region: "Asia", flag: "🇲🇻", alt: ["Malé"],
    facts: [
      "The Maldives is the lowest-lying country in the world, a chain of coral atolls whose ground rarely rises more than a couple of metres above the sea.",
      "Male is one of the most densely populated capitals anywhere, a compact island city packed with colourful buildings ringed by turquoise water."
    ] },
  { c: "Mongolia", cap: "Ulaanbaatar", region: "Asia", flag: "🇲🇳", alt: ["Ulan Bator"],
    facts: [
      "Mongolia is the most sparsely populated sovereign country in the world, a vast land of grassy steppe, desert and nomadic herders on horseback.",
      "Ulaanbaatar is the coldest capital city on Earth, where winter temperatures can plunge far below freezing for months."
    ] },
  { c: "Myanmar", cap: "Naypyidaw", region: "Asia", flag: "🇲🇲", alt: ["Nay Pyi Taw", "Yangon", "Rangoon"],
    facts: [
      "Myanmar, formerly known as Burma, is covered with gilded Buddhist pagodas, including the towering golden Shwedagon in its largest city, Yangon.",
      "Naypyidaw is a purpose-built capital opened in 2005, famous for its enormous and often empty multi-lane highways."
    ] },
  { c: "Nepal", cap: "Kathmandu", region: "Asia", flag: "🇳🇵", alt: [],
    facts: [
      "Nepal is home to Mount Everest, the highest peak on Earth, and eight of the world's ten tallest mountains rise within its borders.",
      "Kathmandu sits in a Himalayan valley filled with ancient temples and palace squares, and Nepal's flag is the only national flag that is not a rectangle."
    ] },
  { c: "North Korea", cap: "Pyongyang", region: "Asia", flag: "🇰🇵", alt: [],
    facts: [
      "North Korea is one of the most secretive and isolated countries in the world, ruled by a single family across three generations.",
      "Pyongyang is a carefully managed showcase capital of wide avenues, grand monuments and the pyramid-shaped Ryugyong Hotel."
    ] },
  { c: "Oman", cap: "Muscat", region: "Asia", flag: "🇴🇲", alt: [],
    facts: [
      "Oman was once a maritime power whose influence reached down the coast of East Africa, and it remains famed for its frankincense.",
      "Muscat is hemmed in by jagged mountains and the sea, and its low, white buildings keep to a traditional style rather than rising into skyscrapers."
    ] },
  { c: "Pakistan", cap: "Islamabad", region: "Asia", flag: "🇵🇰", alt: [],
    facts: [
      "Pakistan contains part of the Indus Valley, home to one of the world's earliest urban civilisations more than 4,000 years ago.",
      "Islamabad is a planned capital built in the 1960s, laid out in a neat grid at the foot of the Margalla Hills."
    ] },
  { c: "Philippines", cap: "Manila", region: "Asia", flag: "🇵🇭", alt: [],
    facts: [
      "The Philippines is made up of more than 7,000 islands and is one of the largest Christian-majority nations in Asia.",
      "Manila is one of the most densely populated cities in the world, set on a bay famous for its glowing sunsets."
    ] },
  { c: "Qatar", cap: "Doha", region: "Asia", flag: "🇶🇦", alt: [],
    facts: [
      "Qatar is among the richest countries per person on Earth, thanks to enormous reserves of natural gas, and it hosted the football World Cup in 2022.",
      "Doha has transformed in a single generation from a pearling town into a skyline of glittering towers along a curved waterfront promenade."
    ] },
  { c: "Saudi Arabia", cap: "Riyadh", region: "Asia", flag: "🇸🇦", alt: [],
    facts: [
      "Saudi Arabia is the birthplace of Islam and home to its holiest cities, Mecca and Medina, drawing millions of pilgrims each year.",
      "Riyadh, whose name relates to the word for gardens, sits in the heart of the desert and has grown into a sprawling modern metropolis."
    ] },
  { c: "Singapore", cap: "Singapore", region: "Asia", flag: "🇸🇬", alt: ["Singapore City"],
    facts: [
      "Singapore is a city-state that rose from a small trading port to one of the world's wealthiest nations in just a few decades.",
      "It is famous for its strict cleanliness, its ban on chewing gum sales and the futuristic Supertree groves of Gardens by the Bay."
    ] },
  { c: "South Korea", cap: "Seoul", region: "Asia", flag: "🇰🇷", alt: [],
    facts: [
      "South Korea turned itself into a high-tech powerhouse and a cultural giant, exporting K-pop, cinema and electronics around the world.",
      "Seoul is a hyper-connected megacity straddling the Han river, blending ancient royal palaces with glowing skyscrapers."
    ] },
  { c: "Sri Lanka", cap: "Colombo", region: "Asia", flag: "🇱🇰", alt: ["Sri Jayawardenepura Kotte", "Kotte"],
    facts: [
      "Sri Lanka is a teardrop-shaped island known for its cinnamon and Ceylon tea, with a recorded history stretching back well over two thousand years.",
      "Colombo is the largest city and commercial heart, while the official seat of parliament lies just outside it at Sri Jayawardenepura Kotte."
    ] },
  { c: "Syria", cap: "Damascus", region: "Asia", flag: "🇸🇾", alt: [],
    facts: [
      "Syria lies at the heart of the ancient Fertile Crescent and contains the ruins of caravan cities like Palmyra.",
      "Damascus is often described as one of the oldest continuously inhabited cities in the world, its old town wrapped in ancient walls."
    ] },
  { c: "Taiwan", cap: "Taipei", region: "Asia", flag: "🇹🇼", alt: [],
    facts: [
      "Taiwan is a mountainous island and a global powerhouse in the manufacture of advanced computer chips that power much of the world's electronics.",
      "Taipei's bamboo-shaped Taipei 101 tower was the tallest building in the world when it opened, and the city is famous for its bustling night markets."
    ] },
  { c: "Tajikistan", cap: "Dushanbe", region: "Asia", flag: "🇹🇯", alt: [],
    facts: [
      "Tajikistan is one of the most mountainous countries on Earth, with the lofty Pamir range nicknamed the Roof of the World.",
      "Dushanbe, whose name means 'Monday' after a former weekly market, has one of the tallest flagpoles in the world."
    ] },
  { c: "Thailand", cap: "Bangkok", region: "Asia", flag: "🇹🇭", alt: [],
    facts: [
      "Thailand is the only Southeast Asian country never colonised by a European power, and its name means 'land of the free'.",
      "Bangkok holds the record for the longest official city name in the world, a ceremonial title dozens of words long that locals shorten to Krung Thep."
    ] },
  { c: "Timor-Leste", cap: "Dili", region: "Asia", flag: "🇹🇱", alt: ["East Timor"],
    facts: [
      "Timor-Leste, or East Timor, was one of the first new sovereign states of the 21st century, gaining full independence in 2002.",
      "Dili lies on the north coast of the island of Timor, overlooked by a towering statue of Christ on a headland above the sea."
    ] },
  { c: "Turkey", cap: "Ankara", region: "Asia", flag: "🇹🇷", alt: ["Turkiye"],
    facts: [
      "Turkey straddles two continents, with part in Europe and part in Asia, divided by the strait that runs through its largest city, Istanbul.",
      "Ankara, not Istanbul, is the capital, chosen by Ataturk as the centre of the new republic he founded in 1923."
    ] },
  { c: "Turkmenistan", cap: "Ashgabat", region: "Asia", flag: "🇹🇲", alt: [],
    facts: [
      "Turkmenistan is mostly covered by the Karakum desert, where a collapsed gas crater nicknamed the Gates of Hell has been burning for decades.",
      "Ashgabat holds a world record for the highest concentration of white marble buildings, giving the capital a gleaming, uniform appearance."
    ] },
  { c: "United Arab Emirates", cap: "Abu Dhabi", region: "Asia", flag: "🇦🇪", alt: ["UAE"],
    facts: [
      "The United Arab Emirates is a federation of seven emirates that rose from desert and pearl diving to dazzling modern wealth.",
      "Abu Dhabi is the capital, while neighbouring Dubai is home to the Burj Khalifa, the tallest building in the world."
    ] },
  { c: "Uzbekistan", cap: "Tashkent", region: "Asia", flag: "🇺🇿", alt: [],
    facts: [
      "Uzbekistan sits on the old Silk Road and contains fabled trading cities like Samarkand and Bukhara, rich in tiled blue domes.",
      "Tashkent is the largest city in Central Asia and is known for a grand metro system whose stations are decorated like underground palaces."
    ] },
  { c: "Vietnam", cap: "Hanoi", region: "Asia", flag: "🇻🇳", alt: [],
    facts: [
      "Vietnam is one of the world's largest exporters of coffee and rice, with emerald rice terraces climbing its northern hills.",
      "Hanoi is the ancient capital, with a maze-like Old Quarter of narrow streets, while the larger Ho Chi Minh City lies in the south."
    ] },
  { c: "Yemen", cap: "Sana'a", region: "Asia", flag: "🇾🇪", alt: ["Sanaa"],
    facts: [
      "Yemen was known in antiquity as Arabia Felix, or Happy Arabia, a green and prosperous land at the southern tip of the Arabian Peninsula.",
      "Sana'a is one of the oldest continuously inhabited cities on Earth, famous for tower houses of brown brick decorated with white geometric patterns."
    ] },
  { c: "Palestine", cap: "Ramallah", region: "Asia", flag: "🇵🇸", alt: ["East Jerusalem", "Jerusalem"],
    facts: [
      "Palestine is a partially recognised state in the Middle East comprising the West Bank and the Gaza Strip.",
      "Ramallah serves as the administrative seat of the Palestinian Authority, while the city of Bethlehem nearby is revered as the birthplace of Jesus."
    ] },

  /* ===================== AFRICA ===================== */
  { c: "Algeria", cap: "Algiers", region: "Africa", flag: "🇩🇿", alt: ["Alger"],
    facts: [
      "Algeria is the largest country in Africa by area, and more than four-fifths of it is covered by the Sahara desert.",
      "Algiers, climbing a hillside above the Mediterranean, is nicknamed Algiers the White for its bright tiers of whitewashed buildings."
    ] },
  { c: "Angola", cap: "Luanda", region: "Africa", flag: "🇦🇴", alt: [],
    facts: [
      "Angola is rich in oil and diamonds and was once a Portuguese colony, so Portuguese remains its official language.",
      "Luanda, perched on the Atlantic coast, has frequently ranked among the most expensive cities in the world for foreign workers."
    ] },
  { c: "Benin", cap: "Porto-Novo", region: "Africa", flag: "🇧🇯", alt: ["Cotonou"],
    facts: [
      "Benin was the cradle of the religion known as Vodun, or Voodoo, and was once the powerful Kingdom of Dahomey.",
      "Porto-Novo is the official capital, although the larger city of Cotonou is the seat of government and economic centre."
    ] },
  { c: "Botswana", cap: "Gaborone", region: "Africa", flag: "🇧🇼", alt: [],
    facts: [
      "Botswana is home to the Okavango Delta, where a great river spills inland and vanishes into the Kalahari, drawing huge herds of wildlife.",
      "Gaborone grew rapidly after diamonds were discovered, helping turn Botswana into one of Africa's economic success stories."
    ] },
  { c: "Burkina Faso", cap: "Ouagadougou", region: "Africa", flag: "🇧🇫", alt: [],
    facts: [
      "Burkina Faso means 'land of upright people', and it hosts one of Africa's biggest film festivals, known as FESPACO.",
      "Ouagadougou, often shortened to Ouaga, is the lively cultural and commercial heart of this landlocked West African nation."
    ] },
  { c: "Burundi", cap: "Gitega", region: "Africa", flag: "🇧🇮", alt: ["Bujumbura"],
    facts: [
      "Burundi is a small, mountainous country whose drummers perform a thunderous traditional ritual recognised by UNESCO.",
      "Gitega became the political capital in 2019, taking over that role from the lakeside city of Bujumbura."
    ] },
  { c: "Cabo Verde", cap: "Praia", region: "Africa", flag: "🇨🇻", alt: ["Cape Verde"],
    facts: [
      "Cabo Verde is a volcanic archipelago in the Atlantic that gave the world the soulful music style known as morna.",
      "Praia, on the island of Santiago, is the capital and main port of this island nation off the West African coast."
    ] },
  { c: "Cameroon", cap: "Yaounde", region: "Africa", flag: "🇨🇲", alt: ["Yaoundé"],
    facts: [
      "Cameroon is sometimes called Africa in miniature for its variety of landscapes, from beaches and deserts to mountains and rainforest.",
      "Yaounde, the capital, is spread across seven hills in the centre of the country, while Douala is the largest city and main port."
    ] },
  { c: "Central African Republic", cap: "Bangui", region: "Africa", flag: "🇨🇫", alt: [],
    facts: [
      "The Central African Republic lies near the very heart of the continent and is rich in diamonds, gold and dense tropical forest.",
      "Bangui sits on the banks of the Ubangi river, which forms a natural border with the neighbouring Democratic Republic of the Congo."
    ] },
  { c: "Chad", cap: "N'Djamena", region: "Africa", flag: "🇹🇩", alt: ["Ndjamena"],
    facts: [
      "Chad is named after Lake Chad, once one of the largest lakes in Africa, which has shrunk dramatically over the past decades.",
      "N'Djamena lies where the Chari and Logone rivers meet, right on the border with Cameroon."
    ] },
  { c: "Comoros", cap: "Moroni", region: "Africa", flag: "🇰🇲", alt: [],
    facts: [
      "The Comoros is a small volcanic archipelago in the Indian Ocean and a leading producer of the fragrant ylang-ylang used in perfumes.",
      "Moroni sits at the foot of an active volcano, Mount Karthala, on the island of Grande Comore."
    ] },
  { c: "Congo (Republic)", cap: "Brazzaville", region: "Africa", flag: "🇨🇬", alt: ["Republic of the Congo"],
    facts: [
      "The Republic of the Congo is covered by vast rainforests that are a stronghold for lowland gorillas and forest elephants.",
      "Brazzaville faces Kinshasa across the Congo river, making the two cities the closest pair of capitals in the world that belong to different countries."
    ] },
  { c: "Congo (DR)", cap: "Kinshasa", region: "Africa", flag: "🇨🇩", alt: ["Democratic Republic of the Congo", "DRC"],
    facts: [
      "The Democratic Republic of the Congo is the largest country in sub-Saharan Africa and holds enormous reserves of cobalt and copper.",
      "Kinshasa is one of the largest French-speaking cities in the world, growing into a sprawling megacity on the Congo river."
    ] },
  { c: "Cote d'Ivoire", cap: "Yamoussoukro", region: "Africa", flag: "🇨🇮", alt: ["Ivory Coast", "Abidjan"],
    facts: [
      "Cote d'Ivoire, or Ivory Coast, is the world's largest producer of cocoa, the raw ingredient of chocolate.",
      "Yamoussoukro is the official capital and home to one of the largest churches in the world, though Abidjan remains the economic powerhouse."
    ] },
  { c: "Djibouti", cap: "Djibouti", region: "Africa", flag: "🇩🇯", alt: ["Djibouti City"],
    facts: [
      "Djibouti sits at a strategic chokepoint where the Red Sea meets the Gulf of Aden, and it contains Lake Assal, the lowest point in Africa.",
      "Djibouti City is a busy port whose location has made it host to military bases from several different world powers."
    ] },
  { c: "Egypt", cap: "Cairo", region: "Africa", flag: "🇪🇬", alt: [],
    facts: [
      "Egypt is home to the last surviving wonder of the ancient world, the Great Pyramid of Giza, built more than 4,500 years ago.",
      "Cairo is the largest city in the Arab world and sits beside the Nile, the river that has sustained Egyptian civilisation for millennia."
    ] },
  { c: "Equatorial Guinea", cap: "Malabo", region: "Africa", flag: "🇬🇶", alt: ["Ciudad de la Paz", "Oyala"],
    facts: [
      "Equatorial Guinea is the only African country where Spanish is an official language, a legacy of its colonial past.",
      "Malabo sits on a volcanic island separate from the mainland, while a brand new planned capital is being built inland."
    ] },
  { c: "Eritrea", cap: "Asmara", region: "Africa", flag: "🇪🇷", alt: [],
    facts: [
      "Eritrea lies along the Red Sea and won its independence from Ethiopia in 1993 after a long struggle.",
      "Asmara is celebrated for its remarkable collection of Italian Art Deco and modernist architecture, earning it a place on the World Heritage list."
    ] },
  { c: "Eswatini", cap: "Mbabane", region: "Africa", flag: "🇸🇿", alt: ["Swaziland", "Lobamba"],
    facts: [
      "Eswatini, formerly Swaziland, is one of the world's last absolute monarchies and one of the smallest countries in Africa.",
      "Mbabane is the administrative capital, while the royal and legislative capital lies nearby at Lobamba in a scenic valley."
    ] },
  { c: "Ethiopia", cap: "Addis Ababa", region: "Africa", flag: "🇪🇹", alt: [],
    facts: [
      "Ethiopia is the only African country never formally colonised, and it follows its own calendar that runs several years behind the rest of the world.",
      "Addis Ababa, whose name means 'new flower', is one of the highest capital cities in the world and hosts the headquarters of the African Union."
    ] },
  { c: "Gabon", cap: "Libreville", region: "Africa", flag: "🇬🇦", alt: [],
    facts: [
      "Gabon protects much of its land in national parks, where rainforests shelter elephants, gorillas and even beach-loving hippos.",
      "Libreville, whose name means 'free town', was founded as a settlement for freed slaves on the Atlantic coast."
    ] },
  { c: "Gambia", cap: "Banjul", region: "Africa", flag: "🇬🇲", alt: [],
    facts: [
      "The Gambia is the smallest country on mainland Africa, a thin sliver of land following the river that gives it its name.",
      "Banjul sits on an island at the mouth of the Gambia river, where it meets the Atlantic Ocean."
    ] },
  { c: "Ghana", cap: "Accra", region: "Africa", flag: "🇬🇭", alt: [],
    facts: [
      "Ghana was the first country in sub-Saharan Africa to gain independence from colonial rule, in 1957, and is a major producer of gold and cocoa.",
      "Accra is a lively coastal capital on the Gulf of Guinea, known for its bustling markets and vibrant music scene."
    ] },
  { c: "Guinea", cap: "Conakry", region: "Africa", flag: "🇬🇳", alt: [],
    facts: [
      "Guinea holds some of the world's largest reserves of bauxite, the ore from which aluminium is made.",
      "Conakry spreads onto the long Kaloum peninsula and nearby islands along the Atlantic coast."
    ] },
  { c: "Guinea-Bissau", cap: "Bissau", region: "Africa", flag: "🇬🇼", alt: [],
    facts: [
      "Guinea-Bissau includes the Bijagos, a beautiful archipelago of islands known for saltwater hippos and rich birdlife.",
      "Bissau is the capital and main port of this small West African nation, a former Portuguese colony."
    ] },
  { c: "Kenya", cap: "Nairobi", region: "Africa", flag: "🇰🇪", alt: [],
    facts: [
      "Kenya is famous for its safaris and the Great Migration, when millions of wildebeest thunder across the Maasai Mara.",
      "Nairobi is the only major city in the world with a national park on its doorstep, where lions and rhinos roam against a skyline backdrop."
    ] },
  { c: "Lesotho", cap: "Maseru", region: "Africa", flag: "🇱🇸", alt: [],
    facts: [
      "Lesotho is the only country in the world that lies entirely above 1,000 metres in elevation, earning it the nickname Kingdom in the Sky.",
      "Maseru sits on the border with South Africa, which completely surrounds this small mountain kingdom."
    ] },
  { c: "Liberia", cap: "Monrovia", region: "Africa", flag: "🇱🇷", alt: [],
    facts: [
      "Liberia was founded in the 19th century as a home for freed American slaves, and its flag closely resembles that of the United States.",
      "Monrovia was named after the American president James Monroe, one of the few capitals named after a foreign head of state."
    ] },
  { c: "Libya", cap: "Tripoli", region: "Africa", flag: "🇱🇾", alt: [],
    facts: [
      "Libya is overwhelmingly desert, and its town of Al Aziziyah once held a long-standing record for the highest temperature measured on Earth.",
      "Tripoli, founded by the ancient Phoenicians, sits on the Mediterranean coast and takes its name from the Greek for 'three cities'."
    ] },
  { c: "Madagascar", cap: "Antananarivo", region: "Africa", flag: "🇲🇬", alt: ["Tananarive"],
    facts: [
      "Madagascar split from other landmasses so long ago that most of its wildlife, including all of its lemurs, is found nowhere else on Earth.",
      "Antananarivo, often shortened to Tana, is a hilly highland capital of steep streets and tall, narrow brick houses."
    ] },
  { c: "Malawi", cap: "Lilongwe", region: "Africa", flag: "🇲🇼", alt: [],
    facts: [
      "Malawi is nicknamed the Warm Heart of Africa for the friendliness of its people, and its huge lake teems with colourful fish.",
      "Lilongwe became the capital in the 1970s, replacing the older city of Zomba, and is split between an old town and a planned new city."
    ] },
  { c: "Mali", cap: "Bamako", region: "Africa", flag: "🇲🇱", alt: [],
    facts: [
      "Mali was the centre of a fabulously wealthy medieval empire, and its city of Timbuktu was a renowned hub of trade and Islamic scholarship.",
      "Bamako lies on the banks of the Niger river and is one of the fastest-growing cities in Africa."
    ] },
  { c: "Mauritania", cap: "Nouakchott", region: "Africa", flag: "🇲🇷", alt: [],
    facts: [
      "Mauritania is mostly Sahara desert, and a giant circular rock formation there, the Eye of the Sahara, is clearly visible from space.",
      "Nouakchott grew from a small village into a sprawling capital in just a few decades as desert nomads settled in the city."
    ] },
  { c: "Mauritius", cap: "Port Louis", region: "Africa", flag: "🇲🇺", alt: [],
    facts: [
      "Mauritius was the only home of the dodo, the flightless bird hunted to extinction within a century of human arrival.",
      "Port Louis is a busy port capital where Hindu temples, mosques and churches reflect the island's diverse population."
    ] },
  { c: "Morocco", cap: "Rabat", region: "Africa", flag: "🇲🇦", alt: [],
    facts: [
      "Morocco is famed for its labyrinthine medinas, the blue city of Chefchaouen and the gateway to the Sahara desert.",
      "Rabat is the capital, although the maze-like markets of Marrakesh and the great mosque of Casablanca are often more famous abroad."
    ] },
  { c: "Mozambique", cap: "Maputo", region: "Africa", flag: "🇲🇿", alt: [],
    facts: [
      "Mozambique has a long Indian Ocean coastline of coral reefs and palm-fringed beaches, and Portuguese is its official language.",
      "Maputo, formerly Lourenco Marques, is known for its wide jacaranda-lined avenues and Mediterranean-style architecture."
    ] },
  { c: "Namibia", cap: "Windhoek", region: "Africa", flag: "🇳🇦", alt: [],
    facts: [
      "Namibia contains the Namib, thought to be the oldest desert in the world, where towering orange dunes meet a foggy Atlantic coast.",
      "Windhoek sits in the central highlands and retains German colonial influences, including breweries and architecture."
    ] },
  { c: "Niger", cap: "Niamey", region: "Africa", flag: "🇳🇪", alt: [],
    facts: [
      "Niger is named after the great river that runs through it, and its northern reaches hold some of the richest dinosaur fossil beds in Africa.",
      "Niamey sits on the banks of the Niger river in the far southwest, one of the hottest major cities in the world."
    ] },
  { c: "Nigeria", cap: "Abuja", region: "Africa", flag: "🇳🇬", alt: ["Lagos"],
    facts: [
      "Nigeria is the most populous country in Africa and home to Nollywood, one of the most prolific film industries in the world.",
      "Abuja is a planned city that replaced Lagos as the capital in 1991, chosen for its central and neutral location."
    ] },
  { c: "Rwanda", cap: "Kigali", region: "Africa", flag: "🇷🇼", alt: [],
    facts: [
      "Rwanda is known as the land of a thousand hills, and its forests are one of the last refuges of the endangered mountain gorilla.",
      "Kigali is regarded as one of the cleanest and safest cities in Africa, helped by a nationwide ban on plastic bags."
    ] },
  { c: "Sao Tome and Principe", cap: "Sao Tome", region: "Africa", flag: "🇸🇹", alt: ["São Tomé"],
    facts: [
      "Sao Tome and Principe is the second smallest country in Africa, a pair of volcanic islands once a major producer of cocoa.",
      "Sao Tome lies almost on the equator, surrounded by rainforest, beaches and dramatic volcanic rock towers."
    ] },
  { c: "Senegal", cap: "Dakar", region: "Africa", flag: "🇸🇳", alt: [],
    facts: [
      "Senegal occupies the westernmost point of mainland Africa and is known for its warm hospitality, summed up by the local word teranga.",
      "Dakar sits on a peninsula reaching into the Atlantic and was once the finish line of the famous Paris-Dakar desert rally."
    ] },
  { c: "Seychelles", cap: "Victoria", region: "Africa", flag: "🇸🇨", alt: [],
    facts: [
      "Seychelles is an Indian Ocean archipelago famous for its giant tortoises and the coco de mer, which bears the largest seed of any plant.",
      "Victoria is one of the smallest national capitals in the world, complete with a miniature replica of London's Big Ben clock tower."
    ] },
  { c: "Sierra Leone", cap: "Freetown", region: "Africa", flag: "🇸🇱", alt: [],
    facts: [
      "Sierra Leone takes its name from the Portuguese for 'lion mountains' and is known for its diamonds and its beautiful beaches.",
      "Freetown was founded as a settlement for freed slaves, and a vast ancient cotton tree long stood as a symbol at its centre."
    ] },
  { c: "Somalia", cap: "Mogadishu", region: "Africa", flag: "🇸🇴", alt: [],
    facts: [
      "Somalia has the longest coastline on mainland Africa, stretching along the Indian Ocean and the Gulf of Aden.",
      "Mogadishu is an ancient port city whose harbour has welcomed traders from across the Indian Ocean for many centuries."
    ] },
  { c: "South Africa", cap: "Pretoria", region: "Africa", flag: "🇿🇦", alt: ["Cape Town", "Bloemfontein"],
    facts: [
      "South Africa is unusual in having three capital cities, dividing the executive, legislative and judicial branches of government among them.",
      "Pretoria is the administrative capital, Cape Town hosts the parliament, and Bloemfontein is the seat of the highest courts."
    ] },
  { c: "South Sudan", cap: "Juba", region: "Africa", flag: "🇸🇸", alt: [],
    facts: [
      "South Sudan is the youngest country in the world, having gained independence from Sudan in 2011.",
      "Juba sits on the White Nile and grew rapidly into the capital of the new nation."
    ] },
  { c: "Sudan", cap: "Khartoum", region: "Africa", flag: "🇸🇩", alt: [],
    facts: [
      "Sudan has more ancient pyramids than Egypt, built by the kingdom of Kush at the desert site of Meroe.",
      "Khartoum stands at the meeting of the Blue Nile and the White Nile, where the two great rivers join to flow north as one."
    ] },
  { c: "Tanzania", cap: "Dodoma", region: "Africa", flag: "🇹🇿", alt: ["Dar es Salaam"],
    facts: [
      "Tanzania is home to Mount Kilimanjaro, the highest peak in Africa, and the wildlife-filled plains of the Serengeti.",
      "Dodoma was made the official capital for its central location, although the coastal city of Dar es Salaam remains the largest and busiest."
    ] },
  { c: "Togo", cap: "Lome", region: "Africa", flag: "🇹🇬", alt: ["Lomé"],
    facts: [
      "Togo is a narrow strip of a country reaching from a short Atlantic coast up into the West African interior.",
      "Lome sits right on the coast next to the border with Ghana and is known for a huge open-air market once run by powerful trader women."
    ] },
  { c: "Tunisia", cap: "Tunis", region: "Africa", flag: "🇹🇳", alt: [],
    facts: [
      "Tunisia was where the ancient city of Carthage rose to challenge Rome, and where the Arab Spring uprisings began in 2010.",
      "Tunis lies near the ruins of Carthage, and its desert landscapes have appeared as alien worlds in famous science fiction films."
    ] },
  { c: "Uganda", cap: "Kampala", region: "Africa", flag: "🇺🇬", alt: [],
    facts: [
      "Uganda was described by Winston Churchill as the Pearl of Africa and shares Lake Victoria, the largest lake on the continent.",
      "Kampala, like Rome, is traditionally said to be built across seven hills, and lies close to the source of the Nile."
    ] },
  { c: "Zambia", cap: "Lusaka", region: "Africa", flag: "🇿🇲", alt: [],
    facts: [
      "Zambia shares the thundering Victoria Falls with Zimbabwe, one of the largest sheets of falling water in the world.",
      "Lusaka grew from a railway settlement into a busy commercial capital at the heart of southern Africa."
    ] },
  { c: "Zimbabwe", cap: "Harare", region: "Africa", flag: "🇿🇼", alt: ["Salisbury"],
    facts: [
      "Zimbabwe is named after Great Zimbabwe, the impressive stone ruins of a medieval African city whose walls were built without mortar.",
      "Harare, formerly called Salisbury, sits on a high plateau and is known for its jacaranda trees that bloom purple each spring."
    ] },

  /* ===================== NORTH AMERICA ===================== */
  { c: "Antigua and Barbuda", cap: "Saint John's", region: "North America", flag: "🇦🇬", alt: ["St. John's", "St Johns"],
    facts: [
      "Antigua and Barbuda is said to have a different beach for every day of the year across its two main Caribbean islands.",
      "Saint John's is a colourful harbour town and the cultural heart of this small twin-island nation."
    ] },
  { c: "Bahamas", cap: "Nassau", region: "North America", flag: "🇧🇸", alt: [],
    facts: [
      "The Bahamas is an archipelago of around 700 islands and cays scattered across crystal-clear Caribbean waters, with swimming pigs on one of them.",
      "Nassau, on New Providence Island, was once a notorious haven for pirates during the golden age of piracy."
    ] },
  { c: "Barbados", cap: "Bridgetown", region: "North America", flag: "🇧🇧", alt: [],
    facts: [
      "Barbados is the birthplace of rum, where the spirit was first distilled in the 17th century, and the home country of the singer Rihanna.",
      "Bridgetown's historic centre and its old military garrison are recognised together as a World Heritage site."
    ] },
  { c: "Belize", cap: "Belmopan", region: "North America", flag: "🇧🇿", alt: [],
    facts: [
      "Belize is home to the Great Blue Hole, a vast circular underwater sinkhole, and the second largest barrier reef in the world.",
      "Belmopan was built inland to become the new capital after a hurricane devastated the old coastal capital of Belize City in 1961."
    ] },
  { c: "Canada", cap: "Ottawa", region: "North America", flag: "🇨🇦", alt: [],
    facts: [
      "Canada is the second largest country in the world by area and contains more lakes than all other countries combined.",
      "Ottawa's Rideau Canal freezes into the world's largest skating rink in winter, drawing skaters right through the heart of the capital."
    ] },
  { c: "Costa Rica", cap: "San Jose", region: "North America", flag: "🇨🇷", alt: ["San José"],
    facts: [
      "Costa Rica abolished its army in 1948 and is a world leader in conservation, with much of its land protected and most power coming from renewables.",
      "San Jose sits in a high central valley ringed by volcanoes and coffee plantations, with a pleasant spring-like climate year round."
    ] },
  { c: "Cuba", cap: "Havana", region: "North America", flag: "🇨🇺", alt: ["La Habana"],
    facts: [
      "Cuba is the largest island in the Caribbean and is famous worldwide for its cigars, its rum and its music.",
      "Havana is celebrated for its vintage 1950s American cars and the faded grandeur of its colonial old town."
    ] },
  { c: "Dominica", cap: "Roseau", region: "North America", flag: "🇩🇲", alt: [],
    facts: [
      "Dominica is known as the Nature Island for its rainforests, hot springs and a boiling lake heated by volcanic activity.",
      "Roseau is a small, brightly painted capital squeezed between green mountains and the Caribbean Sea."
    ] },
  { c: "Dominican Republic", cap: "Santo Domingo", region: "North America", flag: "🇩🇴", alt: [],
    facts: [
      "The Dominican Republic shares the island of Hispaniola with Haiti and is the birthplace of the lively dance music called merengue.",
      "Santo Domingo is the oldest continuously inhabited European-founded city in the Americas, established in 1498."
    ] },
  { c: "El Salvador", cap: "San Salvador", region: "North America", flag: "🇸🇻", alt: [],
    facts: [
      "El Salvador is the smallest country in Central America and the only one without a Caribbean coastline, known as the land of volcanoes.",
      "San Salvador sits in a valley beneath a volcano and El Salvador made headlines as the first country to adopt Bitcoin as legal tender."
    ] },
  { c: "Grenada", cap: "Saint George's", region: "North America", flag: "🇬🇩", alt: ["St. George's", "St Georges"],
    facts: [
      "Grenada is called the Spice Isle and is one of the world's leading producers of nutmeg, which appears on its national flag.",
      "Saint George's wraps around a horseshoe-shaped harbour, its pastel houses climbing the surrounding hills."
    ] },
  { c: "Guatemala", cap: "Guatemala City", region: "North America", flag: "🇬🇹", alt: ["Ciudad de Guatemala"],
    facts: [
      "Guatemala was the heartland of the ancient Maya, whose towering pyramids still rise above the jungle at Tikal.",
      "Guatemala City is the largest city in Central America, set in a highland valley ringed by volcanoes."
    ] },
  { c: "Haiti", cap: "Port-au-Prince", region: "North America", flag: "🇭🇹", alt: [],
    facts: [
      "Haiti became the first independent nation in Latin America and the first country founded by a successful slave revolt, in 1804.",
      "Port-au-Prince sits on a large bay and is known for its vibrant traditions of art and music despite frequent hardship."
    ] },
  { c: "Honduras", cap: "Tegucigalpa", region: "North America", flag: "🇭🇳", alt: [],
    facts: [
      "Honduras was once a major exporter of bananas, and its Caribbean reefs and ruins at Copan draw divers and history lovers alike.",
      "Tegucigalpa is a hilly capital whose tongue-twisting name comes from an indigenous word, often shortened simply to Tegus."
    ] },
  { c: "Jamaica", cap: "Kingston", region: "North America", flag: "🇯🇲", alt: [],
    facts: [
      "Jamaica gave the world reggae music and the legendary Bob Marley, and it has produced some of the fastest sprinters in history.",
      "Kingston has one of the largest natural harbours in the world and is the beating heart of Jamaica's music scene."
    ] },
  { c: "Mexico", cap: "Mexico City", region: "North America", flag: "🇲🇽", alt: ["Ciudad de Mexico", "CDMX"],
    facts: [
      "Mexico was home to the Aztec and Maya civilisations and gave the world chocolate, chillies and the tomato.",
      "Mexico City was built on the ruins of the Aztec capital Tenochtitlan and, sitting on a former lake bed, it slowly sinks year after year."
    ] },
  { c: "Nicaragua", cap: "Managua", region: "North America", flag: "🇳🇮", alt: [],
    facts: [
      "Nicaragua is the largest country in Central America and contains a huge freshwater lake that is home to bull sharks.",
      "Managua sits on the shore of Lake Managua, in a region so seismically active that the city has been rebuilt after major earthquakes."
    ] },
  { c: "Panama", cap: "Panama City", region: "North America", flag: "🇵🇦", alt: ["Ciudad de Panama"],
    facts: [
      "Panama is famous for its canal, an engineering marvel that links the Atlantic and Pacific oceans and reshaped global trade.",
      "Panama City is the only world capital with a tropical rainforest within its city limits, and its skyline bristles with shining towers."
    ] },
  { c: "Saint Kitts and Nevis", cap: "Basseterre", region: "North America", flag: "🇰🇳", alt: ["St. Kitts and Nevis"],
    facts: [
      "Saint Kitts and Nevis is the smallest country in the Americas by both area and population, made up of two volcanic islands.",
      "Basseterre, on the island of Saint Kitts, is guarded by the historic Brimstone Hill Fortress, once nicknamed the Gibraltar of the Caribbean."
    ] },
  { c: "Saint Lucia", cap: "Castries", region: "North America", flag: "🇱🇨", alt: ["St. Lucia"],
    facts: [
      "Saint Lucia is famous for the Pitons, two dramatic volcanic peaks that rise straight from the sea and feature on its flag's reputation as a postcard isle.",
      "Castries sits on a sheltered harbour and is the birthplace of two Nobel laureates, a remarkable feat for such a small island."
    ] },
  { c: "Saint Vincent and the Grenadines", cap: "Kingstown", region: "North America", flag: "🇻🇨", alt: ["St. Vincent and the Grenadines"],
    facts: [
      "Saint Vincent and the Grenadines is a chain of lush islands whose scenery has served as a film backdrop for swashbuckling pirate movies.",
      "Kingstown, on the main island of Saint Vincent, is known as the City of Arches for its many covered stone walkways."
    ] },
  { c: "Trinidad and Tobago", cap: "Port of Spain", region: "North America", flag: "🇹🇹", alt: [],
    facts: [
      "Trinidad and Tobago is the birthplace of the steel drum and of calypso music, and it hosts one of the world's great carnivals.",
      "Port of Spain, on the island of Trinidad, comes alive each year with the colour and rhythm of its famous pre-Lenten carnival."
    ] },
  { c: "United States", cap: "Washington, D.C.", region: "North America", flag: "🇺🇸", alt: ["Washington", "Washington DC", "USA"],
    facts: [
      "The United States is the world's largest economy and spans a huge variety of landscapes, from the Grand Canyon to the Rocky Mountains.",
      "Washington, D.C. was purpose-built as a capital on land carved out between Maryland and Virginia, and it belongs to no state."
    ] },

  /* ===================== SOUTH AMERICA ===================== */
  { c: "Argentina", cap: "Buenos Aires", region: "South America", flag: "🇦🇷", alt: [],
    facts: [
      "Argentina is the birthplace of the tango and home to part of Patagonia, as well as Aconcagua, the highest mountain outside Asia.",
      "Buenos Aires is often called the Paris of South America for its grand boulevards and European-style architecture."
    ] },
  { c: "Bolivia", cap: "Sucre", region: "South America", flag: "🇧🇴", alt: ["La Paz"],
    facts: [
      "Bolivia contains the Salar de Uyuni, the largest salt flat in the world, which turns into a vast natural mirror after rain.",
      "Sucre is the constitutional capital, while La Paz, the highest seat of government in the world, hosts the country's executive."
    ] },
  { c: "Brazil", cap: "Brasilia", region: "South America", flag: "🇧🇷", alt: ["Brasília"],
    facts: [
      "Brazil is the largest country in South America and holds most of the Amazon rainforest, the most biodiverse place on the planet.",
      "Brasilia was built from scratch in just a few years in the 1950s and is laid out, when seen from above, in the shape of an aeroplane."
    ] },
  { c: "Chile", cap: "Santiago", region: "South America", flag: "🇨🇱", alt: [],
    facts: [
      "Chile is one of the longest and narrowest countries in the world, containing the Atacama, the driest desert on Earth.",
      "Santiago sits in a valley with the snow-capped Andes rising dramatically along its eastern edge."
    ] },
  { c: "Colombia", cap: "Bogota", region: "South America", flag: "🇨🇴", alt: ["Bogotá", "Santa Fe de Bogota"],
    facts: [
      "Colombia is one of the most biodiverse countries on Earth and the world's leading source of emeralds, as well as fine coffee.",
      "Bogota is one of the highest major cities in the world, perched on a plateau in the Andes at around 2,600 metres."
    ] },
  { c: "Ecuador", cap: "Quito", region: "South America", flag: "🇪🇨", alt: [],
    facts: [
      "Ecuador is named after the equator, which crosses the country, and it owns the wildlife-rich Galapagos Islands that inspired Darwin.",
      "Quito is one of the highest capital cities in the world and has one of the best-preserved historic centres in Latin America."
    ] },
  { c: "Guyana", cap: "Georgetown", region: "South America", flag: "🇬🇾", alt: [],
    facts: [
      "Guyana is the only South American country with English as its official language and is covered by vast tracts of pristine rainforest.",
      "Georgetown sits below sea level behind a long seawall and is known for its wooden colonial architecture painted white."
    ] },
  { c: "Paraguay", cap: "Asuncion", region: "South America", flag: "🇵🇾", alt: ["Asunción"],
    facts: [
      "Paraguay is one of only two landlocked countries in the Americas, and most of its people speak the indigenous Guarani language.",
      "Asuncion is one of the oldest cities in South America and a mother city from which other colonial settlements were founded."
    ] },
  { c: "Peru", cap: "Lima", region: "South America", flag: "🇵🇪", alt: [],
    facts: [
      "Peru was the heart of the Inca Empire and is home to the breathtaking mountaintop ruins of Machu Picchu.",
      "Lima sits on the edge of a coastal desert and is celebrated as one of the great culinary capitals of the world."
    ] },
  { c: "Suriname", cap: "Paramaribo", region: "South America", flag: "🇸🇷", alt: [],
    facts: [
      "Suriname is the smallest country in South America and the only one where Dutch is the official language.",
      "Paramaribo is known for its distinctive wooden Dutch colonial architecture, recognised as a World Heritage site."
    ] },
  { c: "Uruguay", cap: "Montevideo", region: "South America", flag: "🇺🇾", alt: [],
    facts: [
      "Uruguay hosted and won the very first football World Cup in 1930 and is known for its progressive social policies.",
      "Montevideo sits on the wide River Plate estuary and is home to nearly half of the country's entire population."
    ] },
  { c: "Venezuela", cap: "Caracas", region: "South America", flag: "🇻🇪", alt: [],
    facts: [
      "Venezuela is home to Angel Falls, the tallest uninterrupted waterfall in the world, plunging from a flat-topped mountain.",
      "Caracas lies in a narrow valley near the Caribbean coast, separated from the sea by a steep coastal mountain range."
    ] },

  /* ===================== OCEANIA ===================== */
  { c: "Australia", cap: "Canberra", region: "Oceania", flag: "🇦🇺", alt: [],
    facts: [
      "Australia is the only country that is also a continent, and its unique wildlife includes kangaroos, koalas and the egg-laying platypus.",
      "Canberra was purpose-built as a compromise capital between rival cities Sydney and Melbourne, and was carefully planned from scratch."
    ] },
  { c: "Fiji", cap: "Suva", region: "Oceania", flag: "🇫🇯", alt: [],
    facts: [
      "Fiji is an archipelago of more than 300 islands in the South Pacific, famous for its coral reefs and warm hospitality.",
      "Suva, on the island of Viti Levu, is the largest city in the South Pacific outside Australia and New Zealand."
    ] },
  { c: "Kiribati", cap: "Tarawa", region: "Oceania", flag: "🇰🇮", alt: ["South Tarawa"],
    facts: [
      "Kiribati straddles the equator and the international date line, spreading across a vast stretch of the Pacific Ocean.",
      "South Tarawa, the capital, is a thin chain of low-lying coral islets gravely threatened by rising seas."
    ] },
  { c: "Marshall Islands", cap: "Majuro", region: "Oceania", flag: "🇲🇭", alt: [],
    facts: [
      "The Marshall Islands are made up of coral atolls and were once the site of major nuclear weapons tests at Bikini Atoll.",
      "Majuro is both a town and a long, narrow atoll, where the road runs along a strip of land barely above the waves."
    ] },
  { c: "Micronesia", cap: "Palikir", region: "Oceania", flag: "🇫🇲", alt: ["Federated States of Micronesia"],
    facts: [
      "Micronesia includes the mysterious ruins of Nan Madol, an ancient stone city built on a series of artificial islands.",
      "Palikir, on the island of Pohnpei, is a quiet capital tucked among lush tropical hills."
    ] },
  { c: "Nauru", cap: "Yaren", region: "Oceania", flag: "🇳🇷", alt: [],
    facts: [
      "Nauru is the smallest island nation in the world and once grew wealthy from mining phosphate left by countless seabirds.",
      "Nauru has no official capital, but government offices are located in the district of Yaren."
    ] },
  { c: "New Zealand", cap: "Wellington", region: "Oceania", flag: "🇳🇿", alt: [],
    facts: [
      "New Zealand was the last large landmass settled by humans and its dramatic scenery stood in for Middle-earth in the Lord of the Rings films.",
      "Wellington is the southernmost capital city in the world and is famously windy, perched on a harbour at the bottom of the North Island."
    ] },
  { c: "Palau", cap: "Ngerulmud", region: "Oceania", flag: "🇵🇼", alt: [],
    facts: [
      "Palau is renowned for its Rock Islands and a marine lake filled with millions of stingless jellyfish that swimmers can float among.",
      "Ngerulmud is one of the least populated national capitals in the world, a small purpose-built seat of government on the island of Babeldaob."
    ] },
  { c: "Papua New Guinea", cap: "Port Moresby", region: "Oceania", flag: "🇵🇬", alt: [],
    facts: [
      "Papua New Guinea is one of the most linguistically diverse countries on Earth, where more than 800 distinct languages are spoken.",
      "Port Moresby sits on the south coast, the gateway to a rugged interior of remote highland valleys and dense rainforest."
    ] },
  { c: "Samoa", cap: "Apia", region: "Oceania", flag: "🇼🇸", alt: [],
    facts: [
      "Samoa once skipped an entire day, jumping across the international date line in 2011 to better align with its trading partners.",
      "Apia, on the island of Upolu, was the home of the Scottish writer Robert Louis Stevenson, who is buried on a hill above the town."
    ] },
  { c: "Solomon Islands", cap: "Honiara", region: "Oceania", flag: "🇸🇧", alt: [],
    facts: [
      "The Solomon Islands saw fierce fighting in the Second World War, and divers still explore wartime wrecks in waters known as Iron Bottom Sound.",
      "Honiara, on the island of Guadalcanal, became the capital after the war and is the country's main port and gateway."
    ] },
  { c: "Tonga", cap: "Nuku'alofa", region: "Oceania", flag: "🇹🇴", alt: ["Nukualofa"],
    facts: [
      "Tonga is the only Pacific island nation never formally colonised, keeping its own monarchy throughout its history.",
      "Nuku'alofa, on the island of Tongatapu, lies among lagoons and is one of the first capitals to greet each new day."
    ] },
  { c: "Tuvalu", cap: "Funafuti", region: "Oceania", flag: "🇹🇻", alt: [],
    facts: [
      "Tuvalu is one of the smallest and lowest-lying countries on Earth, and it famously earns money from leasing its internet domain ending in .tv.",
      "Funafuti is a slender coral atoll whose airstrip doubles as a community gathering place when no planes are due."
    ] },
  { c: "Vanuatu", cap: "Port Vila", region: "Oceania", flag: "🇻🇺", alt: [],
    facts: [
      "Vanuatu is home to one of the world's most accessible active volcanoes, where visitors can peer into a glowing crater on Tanna island.",
      "Port Vila, on the island of Efate, is the colourful seaside capital and main hub of this Pacific archipelago."
    ] }

];
