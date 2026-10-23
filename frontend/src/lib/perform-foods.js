// PerForm: the built-in food list (Nutrition tab). Plain, unbranded foods with general macros
// per 100 g, the way a food composition table lists them: a plain name is the food as bought
// (raw), a cooked food says how it was cooked ("Rice, white, cooked"). Carbohydrate is the
// available carbohydrate, fibre apart (2 kcal/g), as on EU labels and in the Portuguese TCA.
// General reference values, rounded; they are meant to be close, not lab-exact.
//
// Row: [id, English name, Portuguese name, kcal, protein, carbs, fat, fibre, icon, extra]
// extra: { raw: true } for a food that also has cooked entries, and
//        { piece: [grams, 'one', 'many', 'um', 'muitos'] } for a food counted in pieces.

const ROWS = [
  // ---- meat, fish, eggs ----
  ['chicken_breast', 'Chicken breast', 'Peito de frango', 120, 22.5, 0, 2.6, 0, 'drumstick', { raw: true }],
  ['chicken_breast_grilled', 'Chicken breast, grilled', 'Peito de frango grelhado', 165, 31, 0, 3.6, 0, 'drumstick'],
  ['chicken_thigh', 'Chicken thigh, skinless', 'Perna de frango sem pele', 121, 19.7, 0, 4.1, 0, 'drumstick', { raw: true }],
  ['chicken_thigh_roasted', 'Chicken thigh, roasted', 'Perna de frango assada', 179, 24.8, 0, 8.2, 0, 'drumstick'],
  ['turkey_breast', 'Turkey breast', 'Peito de peru', 114, 23.7, 0, 1.5, 0, 'drumstick', { raw: true }],
  ['turkey_breast_grilled', 'Turkey breast, grilled', 'Peito de peru grelhado', 147, 30, 0, 2, 0, 'drumstick'],
  ['beef_steak', 'Beef steak, lean', 'Bife de vaca magro', 142, 22, 0, 5.4, 0, 'steak', { raw: true }],
  ['beef_steak_grilled', 'Beef steak, lean, grilled', 'Bife de vaca magro grelhado', 200, 29, 0, 8.5, 0, 'steak'],
  ['beef_mince', 'Beef mince, 10% fat', 'Carne picada de vaca, 10% gordura', 176, 20, 0, 10, 0, 'steak', { raw: true }],
  ['beef_mince_cooked', 'Beef mince, 10% fat, cooked', 'Carne picada de vaca, 10% gordura, cozinhada', 217, 26, 0, 12, 0, 'steak'],
  ['pork_loin', 'Pork loin', 'Lombo de porco', 143, 21, 0, 6.3, 0, 'steak', { raw: true }],
  ['pork_loin_grilled', 'Pork loin, grilled', 'Lombo de porco grelhado', 197, 27.3, 0, 9, 0, 'steak'],
  ['ham', 'Ham, cooked, sliced', 'Fiambre', 107, 17, 1.5, 3.5, 0, 'steak'],
  ['salmon', 'Salmon', 'Salmão', 208, 20, 0, 13, 0, 'fish', { raw: true }],
  ['salmon_grilled', 'Salmon, grilled', 'Salmão grelhado', 206, 22, 0, 12, 0, 'fish'],
  ['cod', 'Cod', 'Bacalhau fresco', 82, 18, 0, 0.7, 0, 'fish', { raw: true }],
  ['cod_salted_soaked', 'Salt cod, soaked', 'Bacalhau demolhado', 76, 17.5, 0, 0.6, 0, 'fish', { raw: true }],
  ['cod_boiled', 'Cod, boiled', 'Bacalhau cozido', 105, 23, 0, 0.9, 0, 'fish'],
  ['hake', 'Hake', 'Pescada', 90, 18.3, 0, 1.3, 0, 'fish', { raw: true }],
  ['hake_boiled', 'Hake, boiled', 'Pescada cozida', 105, 22, 0, 1.6, 0, 'fish'],
  ['sardines_grilled', 'Sardines, grilled', 'Sardinhas grelhadas', 208, 25, 0, 11.5, 0, 'fish'],
  ['tuna_water', 'Tuna, canned in water', 'Atum ao natural', 116, 26, 0, 1, 0, 'can'],
  ['tuna_oil', 'Tuna, canned in oil, drained', 'Atum em óleo, escorrido', 198, 29, 0, 8.2, 0, 'can'],
  ['sardines_canned', 'Sardines, canned in oil, drained', 'Sardinhas em conserva, escorridas', 208, 24.6, 0, 11.5, 0, 'can'],
  ['shrimp', 'Shrimp', 'Camarão', 85, 20, 0, 0.5, 0, 'fish', { raw: true }],
  ['shrimp_cooked', 'Shrimp, cooked', 'Camarão cozido', 99, 24, 0.2, 0.3, 0, 'fish'],
  ['egg', 'Egg, whole', 'Ovo inteiro', 143, 12.6, 0.7, 9.5, 0, 'egg', { raw: true, piece: [55, 'egg', 'eggs', 'ovo', 'ovos'] }],
  ['egg_boiled', 'Egg, boiled', 'Ovo cozido', 155, 12.6, 1.1, 10.6, 0, 'egg', { piece: [50, 'egg', 'eggs', 'ovo', 'ovos'] }],
  ['egg_fried', 'Egg, fried', 'Ovo estrelado', 196, 13.6, 0.8, 15, 0, 'egg', { piece: [46, 'egg', 'eggs', 'ovo', 'ovos'] }],
  ['egg_white', 'Egg white', 'Clara de ovo', 52, 10.9, 0.7, 0.2, 0, 'egg', { raw: true }],
  ['tofu', 'Tofu', 'Tofu', 76, 8, 1.6, 4.8, 0.3, 'bar'],

  // ---- dairy ----
  ['milk_whole', 'Milk, whole', 'Leite gordo', 61, 3.2, 4.8, 3.3, 0, 'glass'],
  ['milk_semi', 'Milk, semi-skimmed', 'Leite meio-gordo', 47, 3.4, 4.8, 1.6, 0, 'glass'],
  ['milk_skim', 'Milk, skimmed', 'Leite magro', 34, 3.4, 5, 0.1, 0, 'glass'],
  ['yogurt_plain', 'Yogurt, plain', 'Iogurte natural', 61, 3.5, 4.7, 3.3, 0, 'cup', { piece: [125, 'pot', 'pots', 'iogurte', 'iogurtes'] }],
  ['yogurt_greek', 'Greek yogurt, plain', 'Iogurte grego natural', 97, 9, 4, 5, 0, 'cup', { piece: [170, 'pot', 'pots', 'iogurte', 'iogurtes'] }],
  ['yogurt_greek_0', 'Greek yogurt, 0% fat', 'Iogurte grego 0% gordura', 59, 10.3, 3.6, 0.4, 0, 'cup', { piece: [170, 'pot', 'pots', 'iogurte', 'iogurtes'] }],
  ['skyr', 'Skyr, plain', 'Skyr natural', 63, 11, 4, 0.2, 0, 'cup', { piece: [150, 'pot', 'pots', 'iogurte', 'iogurtes'] }],
  ['cottage', 'Cottage cheese', 'Queijo cottage', 98, 11, 3.4, 4.3, 0, 'cup'],
  ['cheese_fresh', 'Fresh cheese', 'Queijo fresco', 160, 11, 3, 11, 0, 'cheese'],
  ['cheese_gouda', 'Gouda-type cheese, sliced', 'Queijo flamengo', 356, 25, 2.2, 27.4, 0, 'cheese'],
  ['mozzarella', 'Mozzarella', 'Mozzarella', 280, 28, 3.1, 17, 0, 'cheese'],
  ['parmesan', 'Parmesan', 'Parmesão', 431, 38, 4.1, 29, 0, 'cheese'],
  ['butter', 'Butter', 'Manteiga', 717, 0.9, 0.1, 81, 0, 'cheese'],
  ['whey', 'Whey protein powder', 'Proteína whey em pó', 400, 80, 8, 6, 0, 'cup', { piece: [30, 'scoop', 'scoops', 'dose', 'doses'] }],

  // ---- grains, bread, potatoes ----
  ['rice_white', 'Rice, white', 'Arroz branco', 358, 7, 77.7, 0.6, 1.3, 'wheat', { raw: true }],
  ['rice_white_cooked', 'Rice, white, cooked', 'Arroz branco cozido', 130, 2.7, 27.8, 0.3, 0.4, 'bowl'],
  ['rice_brown', 'Rice, brown', 'Arroz integral', 367, 7.5, 72.5, 2.7, 3.5, 'wheat', { raw: true }],
  ['rice_brown_cooked', 'Rice, brown, cooked', 'Arroz integral cozido', 123, 2.7, 24, 1, 1.6, 'bowl'],
  ['pasta', 'Pasta', 'Massa', 371, 13, 72, 1.5, 3, 'wheat', { raw: true }],
  ['pasta_cooked', 'Pasta, cooked', 'Massa cozida', 158, 5.8, 29.2, 0.9, 1.8, 'pasta'],
  ['pasta_wholewheat', 'Pasta, wholewheat', 'Massa integral', 348, 14.6, 62, 2.5, 9, 'wheat', { raw: true }],
  ['pasta_wholewheat_cooked', 'Pasta, wholewheat, cooked', 'Massa integral cozida', 149, 6, 26.2, 1.7, 3.9, 'pasta'],
  ['quinoa', 'Quinoa', 'Quinoa', 368, 14, 57, 6, 7, 'wheat', { raw: true }],
  ['quinoa_cooked', 'Quinoa, cooked', 'Quinoa cozida', 120, 4.4, 18.5, 1.9, 2.8, 'bowl'],
  ['couscous_cooked', 'Couscous, cooked', 'Cuscuz cozido', 112, 3.8, 21.8, 0.2, 1.4, 'bowl'],
  ['oats', 'Oat flakes', 'Flocos de aveia', 389, 16.9, 55.7, 6.9, 10.6, 'wheat'],
  ['cornflakes', 'Cornflakes', 'Flocos de milho', 357, 7.5, 80, 0.4, 3.3, 'bowl'],
  ['granola', 'Granola', 'Granola', 450, 10, 58, 18, 7, 'bowl'],
  ['bread_white', 'Bread, white', 'Pão branco', 265, 9, 46.4, 3.2, 2.7, 'bread', { piece: [30, 'slice', 'slices', 'fatia', 'fatias'] }],
  ['bread_wholewheat', 'Bread, wholewheat', 'Pão integral', 247, 13, 34, 3.4, 7, 'bread', { piece: [30, 'slice', 'slices', 'fatia', 'fatias'] }],
  ['bread_roll', 'Bread roll', 'Papo-seco', 270, 9, 52, 2.5, 2.5, 'bread', { piece: [50, 'roll', 'rolls', 'pão', 'pães'] }],
  ['bread_corn', 'Corn bread', 'Broa de milho', 230, 5, 45, 2.5, 4, 'bread'],
  ['tortilla', 'Tortilla wrap', 'Tortilha de trigo', 310, 8, 50, 8, 3.5, 'bread', { piece: [60, 'wrap', 'wraps', 'tortilha', 'tortilhas'] }],
  ['rice_cakes', 'Rice cakes', 'Bolachas de arroz', 387, 8, 80, 3, 4, 'bread', { piece: [9, 'cake', 'cakes', 'bolacha', 'bolachas'] }],
  ['potato', 'Potato', 'Batata', 77, 2, 15, 0.1, 2.2, 'potato', { raw: true }],
  ['potato_boiled', 'Potato, boiled', 'Batata cozida', 87, 1.9, 18.2, 0.1, 1.8, 'potato'],
  ['potato_baked', 'Potato, baked', 'Batata assada', 93, 2.5, 18.8, 0.1, 2.2, 'potato'],
  ['fries', 'Chips / french fries', 'Batatas fritas', 312, 3.4, 37.2, 15, 3.8, 'potato'],
  ['sweet_potato', 'Sweet potato', 'Batata-doce', 86, 1.6, 17, 0.1, 3, 'potato', { raw: true }],
  ['sweet_potato_baked', 'Sweet potato, baked', 'Batata-doce assada', 90, 2, 17.4, 0.2, 3.3, 'potato'],

  // ---- pulses ----
  ['beans_red_cooked', 'Red kidney beans, cooked', 'Feijão encarnado cozido', 127, 8.7, 16, 0.5, 6.4, 'bowl'],
  ['beans_black_cooked', 'Black beans, cooked', 'Feijão preto cozido', 132, 8.9, 15.6, 0.5, 8.7, 'bowl'],
  ['chickpeas_cooked', 'Chickpeas, cooked', 'Grão-de-bico cozido', 164, 8.9, 19.8, 2.6, 7.6, 'bowl'],
  ['lentils_cooked', 'Lentils, cooked', 'Lentilhas cozidas', 116, 9, 12, 0.4, 7.9, 'bowl'],
  ['peas_cooked', 'Peas, cooked', 'Ervilhas cozidas', 84, 5.4, 9.5, 0.2, 5.5, 'bowl'],
  ['hummus', 'Hummus', 'Húmus', 166, 8, 8.3, 9.6, 6, 'bowl'],

  // ---- fruit ----
  ['apple', 'Apple', 'Maçã', 52, 0.3, 11.4, 0.2, 2.4, 'apple', { piece: [150, 'apple', 'apples', 'maçã', 'maçãs'] }],
  ['banana', 'Banana', 'Banana', 89, 1.1, 20.2, 0.3, 2.6, 'banana', { piece: [120, 'banana', 'bananas', 'banana', 'bananas'] }],
  ['orange', 'Orange', 'Laranja', 47, 0.9, 9.4, 0.1, 2.4, 'citrus', { piece: [150, 'orange', 'oranges', 'laranja', 'laranjas'] }],
  ['tangerine', 'Tangerine', 'Tangerina', 53, 0.8, 11.6, 0.3, 1.8, 'citrus', { piece: [80, 'tangerine', 'tangerines', 'tangerina', 'tangerinas'] }],
  ['pear', 'Pear', 'Pera', 57, 0.4, 12.1, 0.1, 3.1, 'apple', { piece: [170, 'pear', 'pears', 'pera', 'peras'] }],
  ['kiwi', 'Kiwi', 'Kiwi', 61, 1.1, 11.7, 0.5, 3, 'citrus', { piece: [75, 'kiwi', 'kiwis', 'kiwi', 'kiwis'] }],
  ['peach', 'Peach', 'Pêssego', 39, 0.9, 8, 0.3, 1.5, 'apple', { piece: [150, 'peach', 'peaches', 'pêssego', 'pêssegos'] }],
  ['strawberries', 'Strawberries', 'Morangos', 32, 0.7, 5.7, 0.3, 2, 'berry'],
  ['blueberries', 'Blueberries', 'Mirtilos', 57, 0.7, 12.1, 0.3, 2.4, 'berry'],
  ['grapes', 'Grapes', 'Uvas', 69, 0.7, 17.2, 0.2, 0.9, 'berry'],
  ['mango', 'Mango', 'Manga', 60, 0.8, 13.4, 0.4, 1.6, 'apple'],
  ['pineapple', 'Pineapple', 'Ananás', 50, 0.5, 11.7, 0.1, 1.4, 'citrus'],
  ['watermelon', 'Watermelon', 'Melancia', 30, 0.6, 7.2, 0.2, 0.4, 'citrus'],
  ['melon', 'Melon', 'Melão', 34, 0.8, 7.3, 0.2, 0.9, 'citrus'],
  ['avocado', 'Avocado', 'Abacate', 160, 2, 1.8, 14.7, 6.7, 'apple', { piece: [150, 'avocado', 'avocados', 'abacate', 'abacates'] }],
  ['dates', 'Dates, dried', 'Tâmaras secas', 282, 2.5, 67, 0.4, 8, 'berry', { piece: [8, 'date', 'dates', 'tâmara', 'tâmaras'] }],
  ['raisins', 'Raisins', 'Passas', 299, 3.1, 75, 0.5, 3.7, 'berry'],

  // ---- vegetables ----
  ['broccoli', 'Broccoli', 'Brócolos', 34, 2.8, 4, 0.4, 2.6, 'broccoli', { raw: true }],
  ['broccoli_boiled', 'Broccoli, boiled', 'Brócolos cozidos', 35, 2.4, 4.6, 0.4, 3.3, 'broccoli'],
  ['green_beans_boiled', 'Green beans, boiled', 'Feijão-verde cozido', 35, 1.9, 4.7, 0.3, 3.2, 'leaf'],
  ['carrot', 'Carrot', 'Cenoura', 41, 0.9, 7, 0.2, 2.8, 'leaf', { piece: [60, 'carrot', 'carrots', 'cenoura', 'cenouras'] }],
  ['tomato', 'Tomato', 'Tomate', 18, 0.9, 2.7, 0.2, 1.2, 'apple', { piece: [120, 'tomato', 'tomatoes', 'tomate', 'tomates'] }],
  ['lettuce', 'Lettuce', 'Alface', 15, 1.4, 1.6, 0.2, 1.3, 'leaf'],
  ['spinach', 'Spinach', 'Espinafres', 23, 2.9, 1.4, 0.4, 2.2, 'leaf'],
  ['cucumber', 'Cucumber', 'Pepino', 15, 0.7, 3.1, 0.1, 0.5, 'leaf'],
  ['onion', 'Onion', 'Cebola', 40, 1.1, 7.6, 0.1, 1.7, 'leaf', { piece: [110, 'onion', 'onions', 'cebola', 'cebolas'] }],
  ['pepper_red', 'Red pepper', 'Pimento vermelho', 31, 1, 3.9, 0.3, 2.1, 'leaf', { piece: [150, 'pepper', 'peppers', 'pimento', 'pimentos'] }],
  ['zucchini', 'Courgette', 'Curgete', 17, 1.2, 2.1, 0.3, 1, 'leaf'],
  ['mushrooms', 'Mushrooms', 'Cogumelos', 22, 3.1, 1.3, 0.3, 1, 'leaf'],
  ['cauliflower', 'Cauliflower', 'Couve-flor', 25, 1.9, 3, 0.3, 2, 'broccoli'],
  ['cabbage', 'Cabbage', 'Couve', 25, 1.3, 3.3, 0.1, 2.5, 'leaf'],
  ['pumpkin', 'Pumpkin', 'Abóbora', 26, 1, 6, 0.1, 0.5, 'potato'],
  ['corn_canned', 'Sweet corn, canned', 'Milho doce em lata', 81, 2.6, 13.8, 1.2, 2.4, 'can'],
  ['veg_soup', 'Vegetable soup', 'Sopa de legumes', 35, 1.1, 4.5, 1.3, 1.2, 'bowl'],

  // ---- fats, nuts, seeds ----
  ['olive_oil', 'Olive oil', 'Azeite', 884, 0, 0, 100, 0, 'bottle'],
  ['veg_oil', 'Vegetable oil', 'Óleo vegetal', 884, 0, 0, 100, 0, 'bottle'],
  ['peanut_butter', 'Peanut butter', 'Manteiga de amendoim', 588, 25, 14, 50, 6, 'nut'],
  ['almonds', 'Almonds', 'Amêndoas', 579, 21, 9.1, 50, 12.5, 'nut'],
  ['walnuts', 'Walnuts', 'Nozes', 654, 15, 7, 65, 6.7, 'nut'],
  ['peanuts', 'Peanuts', 'Amendoins', 567, 26, 9.3, 49, 8.5, 'nut'],
  ['cashews', 'Cashews', 'Cajus', 553, 18, 27, 44, 3.3, 'nut'],
  ['chia', 'Chia seeds', 'Sementes de chia', 486, 17, 7.7, 31, 34, 'nut'],
  ['dark_chocolate', 'Dark chocolate, 70%', 'Chocolate negro 70%', 598, 7.8, 35, 43, 11, 'bar'],

  // ---- drinks, sweets, other ----
  ['orange_juice', 'Orange juice', 'Sumo de laranja', 45, 0.7, 10.4, 0.2, 0.2, 'glass'],
  ['coffee', 'Coffee, black', 'Café', 2, 0.1, 0, 0, 0, 'mug'],
  ['beer', 'Beer', 'Cerveja', 43, 0.5, 3.6, 0, 0, 'glass'],
  ['wine_red', 'Wine, red', 'Vinho tinto', 85, 0.1, 2.6, 0, 0, 'glass'],
  ['cola', 'Cola', 'Refrigerante de cola', 42, 0, 10.6, 0, 0, 'glass'],
  ['sugar', 'Sugar', 'Açúcar', 387, 0, 100, 0, 0, 'cup'],
  ['honey', 'Honey', 'Mel', 304, 0.3, 82, 0, 0.2, 'cup'],
  ['jam', 'Jam', 'Doce de fruta', 250, 0.4, 60, 0.1, 1, 'cup'],
  ['ketchup', 'Ketchup', 'Ketchup', 101, 1.2, 23, 0.1, 0.3, 'bottle'],
  ['mayonnaise', 'Mayonnaise', 'Maionese', 680, 1, 0.6, 75, 0, 'bottle'],
  ['pizza', 'Pizza, cheese', 'Pizza de queijo', 266, 11, 30, 10, 2.3, 'bread'],
  ['protein_bar', 'Protein bar', 'Barra proteica', 360, 33, 30, 10, 8, 'bar', { piece: [60, 'bar', 'bars', 'barra', 'barras'] }],
]

/** The built-in foods, one object each: { id, en, pt, k, p, c, f, fb, icon, raw?, piece? }.
 *  piece: { g, one, many, pt1, ptN } — the grams in one piece and its names. */
export const FOODS = ROWS.map(([id, en, pt, k, p, c, f, fb, icon, x = {}]) => ({
  id, en, pt, k, p, c, f, fb, icon,
  ...(x.raw ? { raw: true } : {}),
  ...(x.piece ? { piece: { g: x.piece[0], one: x.piece[1], many: x.piece[2], pt1: x.piece[3], ptN: x.piece[4] } } : {}),
}))

export const FOOD_BY_ID = new Map(FOODS.map(f => [f.id, f]))
