// ---------------------- HEAP HELPERS ----------------------
function swap(heap, i, j) {
    const temp = heap[i];
    heap[i] = heap[j];
    heap[j] = temp;
}

function bubbleUp(heap, index) {
    while (index > 0) {
        const parent = (index - 1) >> 1;
        if (heap[parent].val <= heap[index].val) break;
        swap(heap, index, parent);
        index = parent;
    }
}

function bubbleDown(heap, index) {
    const len = heap.length;
    while (true) {
        let left = 2 * index + 1;
        let right = 2 * index + 2;
        let smallest = index;
        if (left < len && heap[left].val < heap[smallest].val) smallest = left;
        if (right < len && heap[right].val < heap[smallest].val) smallest = right;
        if (smallest === index) break;
        swap(heap, index, smallest);
        index = smallest;
    }
}

function createMinHeap() {
    const heap = [];
    return {
        push(item) {
            heap.push(item);
            bubbleUp(heap, heap.length - 1);
        },
        pop() {
            if (heap.length === 0) return null;
            const top = heap[0];
            const last = heap.pop();
            if (heap.length > 0) {
                heap[0] = last;
                bubbleDown(heap, 0);
            }
            return top;
        },
        peek() {
            return heap[0] || null;
        },
        size() {
            return heap.length;
        },
        isEmpty() {
            return heap.length === 0;
        },
        data: heap
    };
}

// ---------------------- UNION ITERATOR ----------------------

function createUnionIterator(prefixes, prefixData) {
    const heap = createMinHeap();
    const pointers = {};
    let last = -1;

    for (let i = 0; i < prefixes.length; i++) {
        const prefix = prefixes[i];
        const arr = prefixData[prefix];
        if (arr && arr.length > 0) {
            pointers[prefix] = 0;
            heap.push({ val: arr[0], prefix });
        }
    }

    return function next() {
        while (!heap.isEmpty()) {
            const node = heap.pop();
            const prefix = node.prefix;
            const val = node.val;

            const pos = ++pointers[prefix];
            const arr = prefixData[prefix];
            if (pos < arr.length) {
                heap.push({ val: arr[pos], prefix });
            }

            if (val !== last) {
                last = val;
                return val;
            }
        }
        return null;
    };
}

// ---------------------- INTERSECTION ----------------------
function getSuggestionIDs(prefixData, tokenGroups) {
    const unionIters = tokenGroups.map(prefixes => createUnionIterator(prefixes, prefixData));
    const currentVals = new Uint32Array(unionIters.length);
    const master = createMinHeap();

    for (let i = 0; i < unionIters.length; i++) {
        const val = unionIters[i]();
        if (val !== null) {
            currentVals[i] = val;
            master.push({ val, groupIndex: i });
        }
    }

    const result = [];

    while (master.size() === unionIters.length) {
        const vals = master.data.map(x => x.val);
        const min = vals[0];
        const max = vals[vals.length - 1];

        if (min === max) {
            result.push(min);
            if (result.length === 15) break;

            const newHeap = createMinHeap();
            for (let i = 0; i < unionIters.length; i++) {
                const val = unionIters[i]();
                if (val === null) {
                    newHeap.data = [];
                    break;
                }
                currentVals[i] = val;
                newHeap.push({ val, groupIndex: i });
            }
            Object.assign(master, newHeap);
        } else {
            const minVal = master.peek().val;
            const newHeap = createMinHeap();
            for (let i = 0; i < unionIters.length; i++) {
                if (currentVals[i] === minVal) {
                    const val = unionIters[i]();
                    if (val === null) {
                        newHeap.data = [];
                        break;
                    }
                    currentVals[i] = val;
                }
                newHeap.push({ val: currentVals[i], groupIndex: i });
            }
            Object.assign(master, newHeap);
        }
    }
    return result;
}

module.exports = { getSuggestionIDs };