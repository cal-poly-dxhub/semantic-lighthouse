import aws_cdk as core
import aws_cdk.assertions as assertions

from semantic_lighthouse.semantic_lighthouse_stack import SemanticLighthouseStack

# example tests. To run these tests, uncomment this file along with the example
# resource in semantic_lighthouse/semantic_lighthouse_stack.py
def test_sqs_queue_created():
    app = core.App()
    stack = SemanticLighthouseStack(app, "semantic-lighthouse")
    template = assertions.Template.from_stack(stack)

#     template.has_resource_properties("AWS::SQS::Queue", {
#         "VisibilityTimeout": 300
#     })
