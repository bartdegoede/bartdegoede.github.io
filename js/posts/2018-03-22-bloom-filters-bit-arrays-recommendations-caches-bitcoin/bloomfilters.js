var vectorLength = 15,
    elements = [];

function addToBloomFilter(element) {
    elements.push(element);
    $('#elements').html(elements.join(', '));
    $('#bloom_input').val('');
    var a = murmurHash3.x86.hash32(element, 0) % vectorLength;
    var b = murmurHash3.x86.hash32(element, 1) % vectorLength;
    var c = murmurHash3.x86.hash32(element, 2) % vectorLength;
    $('#hash0').html(a);
    $('#hash1').html(b);
    $('#hash2').html(c);

    $('#bits #' + a).css({ 'background-color': '#ac4142' }).addClass('set');
    $('#bits #' + b).css({ 'background-color': '#ac4142' }).addClass('set');
    $('#bits #' + c).css({ 'background-color': '#ac4142' }).addClass('set');
    var probability = (Math.pow($('#bits .set').length / vectorLength, 2) * 100).toFixed(2);
    $('#false_positive_probability').html(probability + '%');
}

function inBloomFilter(element) {
    var a = murmurHash3.x86.hash32(element, 0) % vectorLength;
    var b = murmurHash3.x86.hash32(element, 1) % vectorLength;
    var c = murmurHash3.x86.hash32(element, 2) % vectorLength;
    $('#hash0').html(a);
    $('#hash1').html(b);
    $('#hash2').html(c);

    if ($('#bits #' + a).hasClass('set') && $('#bits #' + b).hasClass('set') && $('#bits #' + c).hasClass('set')) {
        $('#in_bloom_filter span').html('Maybe');
    } else {
        $('#in_bloom_filter span').html('No');
    }
}

$(function() {
    $bits = $('#bits');
    $labels = $('#labels');
    for (var i = 0; i < vectorLength; i++) {
        $bits.append($('<td>', { 'id': i }).css({ 'background-color': '#fff' }).html('&nbsp;'));
        $labels.append($('<td>', { 'id': i }).css({ 'text-align': 'center'}).html(i));
    }

    $('#add_value_to_bloom_filter').click(function() {
        var element = $('#bloom_input').val();
        if (element === '') return;
        addToBloomFilter(element);
    });

    $('#bloom_input').keydown(function(e) {
        if (e.keyCode == '13') {
            e.preventDefault();
            $('#add_value_to_bloom_filter').click();
        }
    });

    $('#test_value_in_bloom_filter').click(function() {
        var element = $('#bloom_input_test').val();
        if (element === '') return;
        inBloomFilter(element);
    });

    $('#bloom_input_test').keydown(function(e) {
        if (e.keyCode == '13') {
            e.preventDefault();
            $('#test_value_in_bloom_filter').click();
        }
    });
});
