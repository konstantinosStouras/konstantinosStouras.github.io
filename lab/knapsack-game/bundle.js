// Fixed version of bundle.js for the Knapsack Game with enhanced mobile drag support
const ITEMS = [
  { id: 1, value: 2, weight: 3 },
  { id: 2, value: 3, weight: 4 },
  { id: 3, value: 4, weight: 6 },
  { id: 4, value: 5, weight: 5 },
  { id: 5, value: 6, weight: 13 },
  { id: 6, value: 9, weight: 8 },
  { id: 7, value: 6, weight: 6 },
  { id: 8, value: 5, weight: 9 },
  { id: 9, value: 8, weight: 2 },
  { id: 10, value: 5, weight: 4 },
  { id: 11, value: 9, weight: 7 },
  { id: 12, value: 9, weight: 7 },
];

const MAX_WEIGHT = 14;
const TARGET_VALUE = 22;
const RISK_LEVELS = [0, 0.2, 0.8];

function shuffleArray(array) {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function KnapsackGame() {
  const [round, setRound] = React.useState(0);
  const [selectedItems, setSelectedItems] = React.useState([]);
  const [availableItems, setAvailableItems] = React.useState(shuffleArray(ITEMS));
  const [draggedItem, setDraggedItem] = React.useState(null);
  const [risk, setRisk] = React.useState(getRandomElement(RISK_LEVELS));
  const [quit, setQuit] = React.useState(false);

  const knapsackRef = React.useRef(null);
  const availableRef = React.useRef(null);

  const currentWeight = selectedItems.reduce((acc, item) => acc + item.weight, 0);
  const currentValue = selectedItems.reduce((acc, item) => acc + item.value, 0);
  const weightLeft = MAX_WEIGHT - currentWeight;

  const onDropToKnapsack = () => {
    if (!draggedItem) return;
    if (!selectedItems.some(i => i.id === draggedItem.id) && currentWeight + draggedItem.weight <= MAX_WEIGHT) {
      setSelectedItems([...selectedItems, draggedItem]);
      setAvailableItems(availableItems.filter(i => i.id !== draggedItem.id));
    }
    setDraggedItem(null);
  };

  const onDropToAvailable = () => {
    if (!draggedItem) return;
    if (!availableItems.some(i => i.id === draggedItem.id)) {
      setAvailableItems([...availableItems, draggedItem]);
      setSelectedItems(selectedItems.filter(i => i.id !== draggedItem.id));
    }
    setDraggedItem(null);
  };

  const handleTouchMove = (e) => {
    if (draggedItem) e.preventDefault();
  };

  const handleTouchStart = (item) => () => {
    setDraggedItem(item);
  };

  const handleTouchEnd = (e) => {
    if (!draggedItem) return;
    const touch = e.changedTouches[0];
    const element = document.elementFromPoint(touch.clientX, touch.clientY);

    if (knapsackRef.current.contains(element)) {
      onDropToKnapsack();
    } else if (availableRef.current.contains(element)) {
      onDropToAvailable();
    }
    setDraggedItem(null);
  };

  React.useEffect(() => {
    const preventDefault = (e) => e.preventDefault();
    document.body.addEventListener('touchmove', preventDefault, { passive: false });
    return () => document.body.removeEventListener('touchmove', preventDefault);
  }, []);

  const renderItem = (item) => (
    React.createElement("div", {
      key: item.id,
      draggable: true,
      onDragStart: () => setDraggedItem(item),
      onTouchStart: handleTouchStart(item),
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      style: { cursor: 'grab', userSelect: 'none' }
    }, `${item.value}$ - ${item.weight}Kg`)
  );

  return React.createElement("div", null,
    React.createElement("div", { ref: availableRef, onDragOver: e => e.preventDefault(), onDrop: onDropToAvailable },
      availableItems.map(renderItem)
    ),
    React.createElement("div", { ref: knapsackRef, onDragOver: e => e.preventDefault(), onDrop: onDropToKnapsack },
      selectedItems.map(renderItem)
    )
  );
}

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(KnapsackGame));
