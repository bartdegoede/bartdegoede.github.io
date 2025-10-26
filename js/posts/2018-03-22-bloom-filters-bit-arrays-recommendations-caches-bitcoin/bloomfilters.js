const vectorLength = 15;
const elements = [];

function addToBloomFilter(element) {
    if (!elements.includes(element)) {
        elements.push(element);
    }

    document.getElementById('elements').textContent = elements.join(', ');
    document.getElementById('bloom_input').value = '';

    const a = murmurHash3.x86.hash32(element, 0) % vectorLength;
    const b = murmurHash3.x86.hash32(element, 1) % vectorLength;
    const c = murmurHash3.x86.hash32(element, 2) % vectorLength;

    document.getElementById('hash0').textContent = a;
    document.getElementById('hash1').textContent = b;
    document.getElementById('hash2').textContent = c;

    // Mark the bits as set
    setBit(a);
    setBit(b);
    setBit(c);

    // Calculate and display probability of false positives
    const setBits = document.querySelectorAll('#bits .set').length;
    const probability = (Math.pow(setBits / vectorLength, 3) * 100).toFixed(2);
    document.getElementById('false_positive_probability').textContent = probability + '%';
}

function setBit(index) {
    const cell = document.querySelector(`#bits td[data-index="${index}"]`);
    if (cell) {
        cell.classList.add('set');
    }
}

function inBloomFilter(element) {
    const a = murmurHash3.x86.hash32(element, 0) % vectorLength;
    const b = murmurHash3.x86.hash32(element, 1) % vectorLength;
    const c = murmurHash3.x86.hash32(element, 2) % vectorLength;

    document.getElementById('hash0').textContent = a;
    document.getElementById('hash1').textContent = b;
    document.getElementById('hash2').textContent = c;

    const bitA = document.querySelector(`#bits td[data-index="${a}"]`);
    const bitB = document.querySelector(`#bits td[data-index="${b}"]`);
    const bitC = document.querySelector(`#bits td[data-index="${c}"]`);

    const resultSpan = document.querySelector('#in_bloom_filter span');
    if (bitA.classList.contains('set') &&
        bitB.classList.contains('set') &&
        bitC.classList.contains('set')) {
        resultSpan.textContent = 'Maybe';
    } else {
        resultSpan.textContent = 'No';
    }
}

// Initialize the bloom filter visualization when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    const bitsRow = document.getElementById('bits');
    const labelsRow = document.getElementById('labels');

    // Create the bit array visualization
    for (let i = 0; i < vectorLength; i++) {
        const bitCell = document.createElement('td');
        bitCell.setAttribute('data-index', i);
        bitCell.innerHTML = '&nbsp;';
        bitsRow.appendChild(bitCell);

        const labelCell = document.createElement('td');
        labelCell.textContent = i;
        labelsRow.appendChild(labelCell);
    }

    // Add button click handler
    document.getElementById('add_value_to_bloom_filter').addEventListener('click', () => {
        const element = document.getElementById('bloom_input').value;
        if (element === '') return;
        addToBloomFilter(element);
    });

    // Add button on Enter key in input
    document.getElementById('bloom_input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('add_value_to_bloom_filter').click();
        }
    });

    // Test button click handler
    document.getElementById('test_value_in_bloom_filter').addEventListener('click', () => {
        const element = document.getElementById('bloom_input_test').value;
        if (element === '') return;
        inBloomFilter(element);
    });

    // Test button on Enter key in input
    document.getElementById('bloom_input_test').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            document.getElementById('test_value_in_bloom_filter').click();
        }
    });
});
